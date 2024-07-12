import express from 'express'
import ethers from 'ethers'
import BN from 'bignumber.js'
import crypto from 'crypto'
import { RFQOffer, RFQQuoteRequest, RFQQuoteResponse } from './types.js'
import { isETH } from './finders/utils/addresses.js'
import dotenv from 'dotenv'
import { USDTAddresses } from './constant.js'
import ERC20 from "@uniswap/v2-core/build/ERC20.json" assert { type: 'json' }
dotenv.config()

const url = process.env.JSON_RPC_PROVIDER
const provider = new ethers.providers.StaticJsonRpcProvider(url)
const port = 9000
const app = express()

app.use(express.json())

const privateKey = process.env.MOCK_MM_PRIVATEKEY
const allowContractSender = parseInt(process.env.ALLOW_CONTRACT_SENDER || "0") === 1 ? true : false
const allowPartialFilled = parseInt(process.env.ALLOW_PARTIAL_FILL || "0") === 1 ? true : false
const FLG_ALLOW_CONTRACT_SENDER = 1n << 255n
const FLG_ALLOW_PARTIAL_FILL = 1n << 254n
const OFFER_EXPIRY = 5 * 60 // 30 mins

console.log(`allowContractSender: ${allowContractSender}`)
console.log(`allowPartialFilled: ${allowPartialFilled}`)

const smartOrderStrategyAddress = {
  1: `0x5e30Ee498190C6F5D602f977ECEDad035745B796`,
  11155111: `0x3A9AD38c4440E90b80f89cF6D0dE25df8bDF7128`,
}

const v6RFQContractAddress = {
  1: `0xF45b4428B02e5EFFf08a88F4383224d6EA447935`,
  11155111: `0x4a91D7c1bEfd96C29306a421719c4FDAAB205d14`,
}

const wethAddress = {
  1: `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`,
  11155111: `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`,
}

// only for testing, these keys and addresses are publicly known
const wallet = new ethers.Wallet(privateKey)
console.log(`maker wallet address: ${wallet.address}`)

const signRFQOffer = async (
  chainId: number,
  rfqOffer: RFQOffer
) => {
  const domain = {
    name: 'Tokenlon',
    version: 'v6',
    chainId: chainId,
    verifyingContract: v6RFQContractAddress[chainId],
  }
  const types = {
    RFQOffer: [
      { name: 'taker', type: 'address' },
      { name: 'maker', type: 'address' },
      { name: 'takerToken', type: 'address' },
      { name: 'takerTokenAmount', type: 'uint256' },
      { name: 'makerToken', type: 'address' },
      { name: 'makerTokenAmount', type: 'uint256' },
      { name: 'feeFactor', type: 'uint256' },
      { name: 'flags', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'salt', type: 'uint256' }
    ],
  }

  const offerHash = await ethers.utils._TypedDataEncoder.hashStruct('RFQOffer', types, rfqOffer)
  const signature = await wallet._signTypedData(domain, types, rfqOffer)
  return {
    offerHash,
    signature
  }
}

const isUSDT = (chainId: number, address: string): boolean => {
  return address.toLowerCase() === USDTAddresses[chainId].toLowerCase()
}

const generateSalt = () => {
  return `0x${crypto.randomBytes(32).toString('hex').padStart(64, '0')}`
}

const calculateRate = (quoteRequest: RFQQuoteRequest) => {
  if (isETH(quoteRequest.fromToken.address) &&
    isUSDT(quoteRequest.chainId, quoteRequest.toToken.address)) {
      return 3100
  }

  if (isUSDT(quoteRequest.chainId, quoteRequest.fromToken.address) &&
    isETH(quoteRequest.toToken.address)) {
      return 0.00040
  }
  return 0
}

const calculateAmounts = async (quoteRequest: RFQQuoteRequest, percentage: number): Promise<{
  takerTokenAmount: string,
  makerTokenAmount: string,
  toTokenBalance: string
}> => {
  let toTokenTemp = quoteRequest.toToken
  const toTokenAddress = isETH(toTokenTemp.address) ? wethAddress[quoteRequest.chainId] : toTokenTemp.address
  const toTokenContract = new ethers.Contract(toTokenAddress, ERC20.abi, provider)
  let toTokenBalanceResult = await toTokenContract.balanceOf(wallet.address)
  const toTokenBalance = String(toTokenBalanceResult ?? 0).toString()
  // fill only 90% sellAmount
  const tradableAmountIn = new BN(quoteRequest.sellAmount)
    .multipliedBy(percentage)
    .toFixed(quoteRequest.fromToken.decimals)
  let takerTokenAmountWei = ethers.utils
    .parseUnits(tradableAmountIn, quoteRequest.fromToken.decimals)
    .toString()
  // fixed 1 ETH -> 3900 USDT swap
  const fixedRate = calculateRate(quoteRequest)
  const makerTokenAmountString = new BN(tradableAmountIn)
    .multipliedBy(fixedRate)
    .toFixed(quoteRequest.toToken.decimals)
  // calculate the maximum maker token amount which the market maker is willing to trade
  let makerTokenAmountWei = ethers.utils
    .parseUnits(makerTokenAmountString, quoteRequest.toToken.decimals)
    .toString()
  if (new BN(makerTokenAmountWei).gt(toTokenBalance)) {
    console.log(`quoting for it's balance`)
    const formattedToBalanceAmount = ethers.utils.formatUnits(toTokenBalance, quoteRequest.toToken.decimals)
    const formattedFromBalanceAmount = new BN(formattedToBalanceAmount).multipliedBy(new BN(1).dividedBy(fixedRate)).toFixed(quoteRequest.fromToken.decimals)
    takerTokenAmountWei = ethers.utils.parseUnits(formattedFromBalanceAmount, quoteRequest.fromToken.decimals).toString()
    makerTokenAmountWei = toTokenBalance
  }
  console.log({
    takerTokenAmount: takerTokenAmountWei,
    makerTokenAmount: makerTokenAmountWei,
    toTokenBalance,
  })
  return {
    takerTokenAmount: takerTokenAmountWei,
    makerTokenAmount: makerTokenAmountWei,
    toTokenBalance,
  }
}

const makeIntermediateSwapOffer = async (quoteRequest: RFQQuoteRequest): Promise<RFQOffer[]> => {
  const offers: RFQOffer[] = []
  const fromToken = quoteRequest.fromToken
  const toToken = quoteRequest.toToken
  const flags = allowPartialFilled ?
    (FLG_ALLOW_CONTRACT_SENDER | FLG_ALLOW_PARTIAL_FILL).toString() : 
    (FLG_ALLOW_CONTRACT_SENDER).toString()
  const { takerTokenAmount, makerTokenAmount } = await calculateAmounts(quoteRequest, 1)
  const rfqOffer: RFQOffer = {
    taker: smartOrderStrategyAddress[quoteRequest.chainId],
    maker: wallet.address,
    takerToken: isETH(fromToken.address) ? wethAddress[quoteRequest.chainId] : fromToken.address,
    takerTokenAmount: takerTokenAmount,
    makerToken: isETH(toToken.address) ? wethAddress[quoteRequest.chainId] : toToken.address,
    makerTokenAmount: makerTokenAmount,
    feeFactor: '0',
    flags: flags,
    expiry: (Math.floor(Date.now() / 1000) + OFFER_EXPIRY).toString(),
    salt: generateSalt(),
  }
  const { offerHash, signature } = await signRFQOffer(quoteRequest.chainId, rfqOffer)
  rfqOffer.offerHash = offerHash
  rfqOffer.makerSignature = signature
  offers.push(rfqOffer)
  return offers
}

const makeDirectSwapOffers = async (quoteRequest: RFQQuoteRequest): Promise<RFQOffer[]> => {
  const offers: RFQOffer[] = []
  const fromToken = quoteRequest.fromToken
  const toToken = quoteRequest.toToken
  const userAddress = quoteRequest.userAddress
  const amountInWei = ethers.utils.parseUnits(quoteRequest.sellAmount, quoteRequest.fromToken.decimals).toString()
  const { takerTokenAmount, makerTokenAmount, toTokenBalance } = await calculateAmounts(quoteRequest, 1)
  const couldQuoteForEntireOrder = new BN(makerTokenAmount).lte(toTokenBalance)
  if (couldQuoteForEntireOrder && new BN(amountInWei).eq(takerTokenAmount)) {
    const rfqOffer: RFQOffer = {
      taker: userAddress,
      maker: wallet.address,
      takerToken: fromToken.address,
      takerTokenAmount: takerTokenAmount,
      // makerToken should be weth
      makerToken: toToken.address,
      makerTokenAmount: makerTokenAmount,
      feeFactor: quoteRequest.feeFactor.toString(),
      flags: '0',
      expiry: (Math.floor(Date.now() / 1000) + OFFER_EXPIRY).toString(),
      salt: generateSalt(),
    }
    const { offerHash, signature } = await signRFQOffer(quoteRequest.chainId, rfqOffer)
    rfqOffer.offerHash = offerHash
    rfqOffer.makerSignature = signature
    offers.push(rfqOffer)
  }

  if (allowContractSender && (new BN(takerTokenAmount).lte(amountInWei))) {
    const { takerTokenAmount, makerTokenAmount } = await calculateAmounts(quoteRequest, 1)
    const flags = allowPartialFilled ?
      (FLG_ALLOW_CONTRACT_SENDER | FLG_ALLOW_PARTIAL_FILL).toString() : 
      (FLG_ALLOW_CONTRACT_SENDER).toString()
    const rfqOffer: RFQOffer = {
      taker: smartOrderStrategyAddress[quoteRequest.chainId],
      maker: wallet.address,
      // for allowed partial filled direct swap, it's takerToken should be weth
      takerToken: isETH(fromToken.address) ? wethAddress[quoteRequest.chainId] : fromToken.address,
      takerTokenAmount: takerTokenAmount,
      // makerToken should be weth
      makerToken: isETH(toToken.address) ? wethAddress[quoteRequest.chainId] : toToken.address,
      makerTokenAmount: makerTokenAmount,
      feeFactor: '0',
      flags: flags,
      expiry: (Math.floor(Date.now() / 1000) + OFFER_EXPIRY).toString(),
      salt: generateSalt(),
    }
    const { offerHash, signature } = await signRFQOffer(quoteRequest.chainId, rfqOffer)
    rfqOffer.offerHash = offerHash
    rfqOffer.makerSignature = signature
    offers.push(rfqOffer)
  }

  return offers
}

app.post('/quote', async (req, res) => {
  try {
    const quoteRequest: RFQQuoteRequest = req.body
    console.log(`quoteRequest:`)
    console.log(quoteRequest)
    const isIntermediateSwap = quoteRequest.isIntermediateSwap
    if (!allowContractSender && isIntermediateSwap) {
      const response: RFQQuoteResponse = {
        exchangeable: false,
        message: "unsupported quote request"
      }
      console.log(response)
      res.send(response)
      return
    }

    let offers: RFQOffer[] = []
    if (!isIntermediateSwap) {
      offers = await makeDirectSwapOffers(quoteRequest)
    } else {
      offers = await makeIntermediateSwapOffer(quoteRequest)
    }

    const response: RFQQuoteResponse = {
      exchangeable: true,
      offers: offers,
    }
    console.log(response)
    res.send(response)
  } catch (e) {
    console.error(e)
    res.status(500).send(e)
  }
})

app.post('/deal', async (req, res) => {
  const body = req.body
  console.log(`request: ${JSON.stringify(body)}`)
  res.send({
    result: true,
    message: 'ok',
  })
})

app.post('/exception', async (req, res) => {
  const body = req.body
  console.log(`request: ${JSON.stringify(body)}`)
  res.send({
    result: true,
    message: 'ok',
  })
})

app.listen(port, async () => {
  console.log(`App listening on port ${port}`)
})
