# Request for Quote Version 6 Protocol
## Introduction
Request For Quote Version 6 (RFQ v6) is a protocol designed to facilitate market makers' access to Tokenlon v6 aggregator system, enabling them to provide their quotes and utilize their liquidity effectively. The primary goal of RFQ v6 is to improve the overall order quoting process, reduce slippage, and enhance the protocol's capacity to handle larger trading volumes.

## Purpose
The purpose of RFQ v6 is to establish a standardized method for market makers to interact with the Tokenlon v6 aggregator system. By adhering to this protocol, market makers can seamlessly integrate their quoting mechanisms and liquidity provision into the system, thereby enhancing the efficiency and reliability of order execution.

## Key Features
1. Market Maker Integration: RFQ v6 allows market makers to integrate their quoting systems with the Tokenlon v6 aggregator, enabling them to submit quotes directly to the system.

2. Improved Order Quoting: By leveraging RFQ v6, market makers can provide more accurate and timely quotes, resulting in improved order execution for traders.

3. Reduced Slippage: The protocol aims to minimize slippage by optimizing the quoting process and ensuring that quotes are executed at prices closer to the market rate.

4. Scalability: RFQ v6 is designed to handle larger trading volumes, ensuring that the Tokenlon v6 aggregator system can accommodate increased demand.

## Integration Checklist
To integrate into RFQv6 as a market maker, you need to:

1. Set up a signing wallet to sign RFQOffer ERC712 structures. Share its address with the Tokenlon team.
2. Prepare an EOA or ERC1271-compliant smart contract capable of verifying ERC712 signatures.
3. Provide the host and port details of your quoting endpoint.
4. Specify the ERC20 token addresses for the trading pairs you support. Share this information with the Tokenlon team.
5. Directly approve ERC20 tokens to the RFQ contract address `0xF45b4428B02e5EFFf08a88F4383224d6EA447935`. Note: This contract handles token transfers only between taker and maker and is not upgradable.

## Implementation
Market makers can implement RFQ v6 by following the protocol specifications outlined in the documentation. This includes integrating the necessary APIs and adhering to the communication standards required for interacting with the aggregator system.

Market makers integrating with RFQ v6 need to implement the following three APIs:

1. Quote API
2. Deal API
3. Exception API

### Quote API

This API endpoint is responsible for handling requests from the Tokenlon v6 system to obtain quotes.

Endpoint: **POST /quote**

Request Body:

```
{
    "rfqAPIVersion": 6.0,
    "isIntermediateSwap": boolean,
    "userAddress": string,
    "chainId": number,
    "feeFactor": number,
    "requestId": string,
    "fromToken": {
        "chainId": number,
        "address": string,
        "symbol": string,
        "decimals": number
    },
    "toToken": {
        "chainId": number,
        "address": string,
        "symbol": string,
        "decimals": number
    },
    "sellAmount": string
}
```

The `isIntermediateSwap` field indicates whether the current quote request is part of a sub-route within the Smart Order Routing (SOR) mechanism or if it's a direct quote request for the original pair provided by the user.

When `isIntermediateSwap` is set to **true**:

* It signifies that the quote request is being processed as a sub-route within the SOR mechanism.

* This typically occurs when the Tokenlon v6 system routes an order through multiple liquidity sources or performs token swaps to fulfill the user's order optimally.
* Market makers should consider this information when providing quotes and adjust their pricing strategy accordingly, taking into account the potential impact of intermediate token swaps on the overall trade execution.

When `isIntermediateSwap` is set to **false**:

* It indicates that the quote request is for the original pair provided by the user.
* Market makers can treat this quote request as a direct request for the specified trading pair, without the need to consider any additional token swaps or routing complexities.
* Understanding the value of the `isIntermediateSwap` field allows market makers to tailor their quoting strategies based on the specific context of the quote request, ensuring optimal pricing and execution for the user's trades within the Tokenlon v6 ecosystem.

Response Body:
```
{
    "exchangeable": boolean,
    "message": string,
    "offers": [{
        "taker": string,
        "maker": string,
        "takerToken": string,
        "takerTokenAmount": string,
        "makerToken": string,
        "makerTokenAmount": string,
        "feeFactor": number,
        "flags": string,
        "expiry": number,
        "salt": string,
        "makerSignature": string,
        "offerHash": string
    }]
}
```

RFQOffers can be tailored to the quantity of the user's quote request, providing tiered quotes with different prices based on the requested amount.

#### Signing RFQ Offers
When makers sign RFQ offers, they should follow the signing process outlined below, which adheres to the ERC712 signature standard:

```typescript
import { ethers } from 'ethers';

export interface RFQOffer {
  taker: string;
  maker: string;
  takerToken: string;
  takerTokenAmount: string;
  makerToken: string;
  makerTokenAmount: string;
  feeFactor: string;
  flags: string;
  expiry: string;
  salt: string;
  offerHash?: string;
  makerSignature?: string;
}

const signRFQOffer = async (
  chainId: number,
  rfqOffer: RFQOffer
) => {
  const domain = {
    name: 'Tokenlon',
    version: 'v6',
    chainId: 1,
    verifyingContract: '0xF45b4428B02e5EFFf08a88F4383224d6EA447935',
  };
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
  };

  const offerHash = await ethers.utils._TypedDataEncoder.hashStruct('RFQOffer', types, rfqOffer);
  const signature = await wallet._signTypedData(domain, types, rfqOffer);
  return {
    offerHash,
    signature
  };
};
```

#### Generating `salt` for RFQOffer

To ensure the security and uniqueness of the salt used in the RFQOffer signature process, it is recommended to generate a random 32-byte hexadecimal string with leading zeros. Below is a suggested method for generating such a salt:

```typescript
import crypto from 'crypto';

const generateSalt = () => {
  return `0x${crypto.randomBytes(32).toString('hex').padStart(64, '0')}`;
};
```

#### Generating `flags` for RFQOffer

Flags in the RFQOffer are generated by setting specific bits to represent various options or permissions related to the RFQ offer. Each flag corresponds to a specific bit position within a uint256 variable in Solidity.

Here's how the flags are generated based on the provided constants:

**FLG_ALLOW_CONTRACT_SENDER**: This flag is set by shifting the value 1 by 255 bits to the left. This effectively sets the 256th bit to 1, indicating that the market maker allows their RFQOffer to be triggered for execution by contracts other than the RFQ contract itself.

**FLG_ALLOW_PARTIAL_FILL**: This flag is set by shifting the value 1 by 254 bits to the left. This sets the 255th bit to 1, indicating that the market maker allows their RFQOffer to be partially filled.

**FLG_MAKER_RECEIVES_WETH**: This flag is set by shifting the value 1 by 253 bits to the left. When the flag is enabled, the maker will receive WETH in trades where the takerToken is WETH or ETH. Otherwise, the maker will receive ETH.

To combine these flags and form the flags variable, the bitwise OR operation (|) is used to set the corresponding bits to 1 if the flags are enabled. The resulting flags value represents the union of both flags.

Here's the process to generate the flags variable:

```typescript
const FLG_ALLOW_CONTRACT_SENDER = BigInt(1) << BigInt(255);
const FLG_ALLOW_PARTIAL_FILL = BigInt(1) << BigInt(254);
const FLG_MAKER_RECEIVES_WETH = BigInt(1) << BigInt(253);

// Combine the flags using bitwise OR operation
const flags = FLG_ALLOW_CONTRACT_SENDER | FLG_ALLOW_PARTIAL_FILL | FLG_MAKER_RECEIVES_WETH;
```

#### Constructing RFQOffer
When `isIntermediateSwap` is set to false, the system aims to receive two or more RFQOffers with different settings in a single response.

Each RFQOffer corresponds to a different set of flags:

* **RFQOffer with Flags = 0**:
This RFQOffer is configured with flags set to 0, indicating that the offer is intended for execution exclusively through the RFQv6 smart contract. It does not allow partial fills or external contract interactions.
* **RFQOffer with Flags = FLG_ALLOW_CONTRACT_SENDER | FLG_ALLOW_PARTIAL_FILL**:
This configuration permits the offer to be partially filled and allows execution via external contracts. Note: Market makers retain ultimate discretion during the quoting process. They can choose whether to provide this flexibility or prefer to limit execution solely through the RFQv6 smart contract.

Before all quotes are aggregated, the final outcome is uncertain. Therefore, RFQOffers need to cater to all possible aggregation scenarios during the quoting phase. However, it's important to note that only one of the RFQOffers, either with flags set to 0 or with flags set to FLG_ALLOW_CONTRACT_SENDER | FLG_ALLOW_PARTIAL_FILL, will ultimately be selected.

Different settings are applied to the RFQOffer structure's taker, takerToken, makerToken and feeFactor based on the values of different flags. Here's a detailed explanation of the configurations for different flag settings:

##### When flags are set to 0

The RFQOffer is not allowed to be partially filled and is constrained to be executed solely via the RFQ smart contract and cannot be triggered by any external contracts or mechanisms.

* taker: Uses the user-provided address.
* takerToken: Utilizes the original fromToken address.
* makerToken: If the toToken address is Ether, it employs the WETH address(`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`); otherwise, it uses the original toToken address.
* feeFactor: When flags are set to 0, Tokenlon calculates a reasonable fee factor for makers to sign since a single RFQOffer is expected to be the final aggregation result.

##### When flags include `FLG_ALLOW_CONTRACT_SENDER`:

* taker: Employs the `SmartOrderStrategy` address `0x5e30Ee498190C6F5D602f977ECEDad035745B796`.
* takerToken: If the fromToken address is Ether, it uses the WETH address; otherwise, it utilizes the original fromToken address.
* makerToken: If the toToken address is Ether, it utilizes the WETH address; otherwise, it uses the original toToken address.
* feeFactor: When flags include `FLG_ALLOW_CONTRACT_SENDER`, the fee for the entire order is handled differently, allowing market makers to sign with a feeFactor = 0 to avoid duplicate fee charges.

Different flag settings impact the configuration of taker, takerToken, and makerToken in the RFQOffer structure during direct swaps. These configurations allow for flexible adjustment of RFQOffer behavior to accommodate various trading scenarios and strategies.

When `isIntermediateSwap` is set to true and the market maker deems it suitable to provide a quote, it's crucial to configure the RFQOffer with the appropriate flags to ensure smooth execution of the order and avoid unexpected errors. Specifically, both `FLG_ALLOW_CONTRACT_SENDER` and `FLG_ALLOW_PARTIAL_FILL` flags need to be set in the `flags`.

By configuring the RFQOffer with these settings, the market maker ensures compatibility with the intermediate swap scenario, aligning with the routing strategy and token types involved. This approach fosters a seamless quoting process within the Tokenlon v6 ecosystem, mitigating potential execution errors and optimizing trading efficiency across various liquidity sources and token pairs.

### Deal API

The Deal API is used by the Tokenlon v6 system to notify market makers about the execution of orders and to store relevant information in the database. This API also serves as a callback mechanism for market makers to update their order statuses and handle subsequent risk hedging tasks.

Endpoint: **POST /deal**

Request Body:
```
{
    "isSOROrder": boolean,
    "type": string
    "requestId": uuid,
    "fromToken": {
        "chainId": number,
        "address": string,
        "symbol": string,
        "decimals": number
    },
    "toToken": {
        "chainId": number,
        "address": string,
        "symbol": string,
        "decimals": number
    },
    "involvedOffers": [
        {
            "fromToken": "0x1111111...",
            "toToken": "0x22222222...",
            "offerHash": "0x7b24215e....",
            "makerTokenAmount": 3000000000,
            "involvedMakerTokenAmount": 2500000000,
            "maker": "0x123456......."
        }
        ...
    ],
    "timestamp": number
}

```

* **isSOROrder**: Indicates whether the order is routed through the Smart Order Routing (SOR) mechanism or a simple RFQ swap.
* **type**: Describes the status of the current order.
* **requestId**: Unique identifier for the request.
* **fromToken**: Details of the token being exchanged from.
* **toToken**: Details of the token being exchanged to.
* **involvedOffers**: Information about the RFQ offers involved in the deal.
    * **fromToken**: Address of the token being exchanged from.
    * **toToken**: Address of the token being exchanged to.
    * **offerHash**: Hash of the RFQ offer involved in the deal.
    * **makerTokenAmount**: Total amount of maker token in the offer (in wei precision).
    * **involvedMakerTokenAmount**: Amount of maker token involved in the deal (in wei precision).
    * **maker**: Address of the maker associated with the offer.
* **timestamp**: Describes the time when the status of the current order changes.

Response Body:

```
{
    "result": boolean,
    "message": string
}
```

*   **result**: Boolean indicating the success or failure of the deal processing.
*   **message**: Additional information about the result (optional).

### Exception API

The Exception API is utilized to notify market makers about various types of exceptions, such as order timeouts, failed executions on the blockchain, and other pertinent information. This callback mechanism enables market makers to be informed promptly and execute related tasks such as risk hedging and releasing trading capacity.

Endpoint: **POST /exception**

Request Body:
```
{
    "isSOROrder": boolean,
    "type": string
    "requestId": uuid,
    "fromToken": {
        "chainId": number,
        "address": string,
        "symbol": string,
        "decimals": number
    },
    "toToken": {
        "chainId": number,
        "address": string,
        "symbol": string,
        "decimals": number
    },
    "involvedOffers": [
        {
            "fromToken": "0x1111111...",
            "toToken": "0x22222222...",
            "offerHash": "0x7b24215e....",
            "makerTokenAmount": 3000000000,
            "involvedMakerTokenAmount": 2500000000,
            "maker": "0x123456......."
        },
        ...
    ],
    "timestamp": number
}
```

* **isSOROrder**: Indicates whether the order is routed through the Smart Order Routing (SOR) mechanism or a simple RFQ swap.
* **type**: Describes the status of the current order.
* **requestId**: Universally unique identifier (UUID) for the request.
* **fromToken**: Details of the token being exchanged from.
* **toToken**: Details of the token being exchanged to.
* **involvedOffers**: Information about the RFQ offers involved in the exception.
    *   **fromToken**: Address of the token being exchanged from.
    *   **toToken**: Address of the token being exchanged to.
    *   **offerHash**: Hash of the RFQ offer involved in the exception.
    *   **makerTokenAmount**: Total amount of maker token in the offer (in wei precision).
    *   **involvedMakerTokenAmount**: Amount of maker token involved in the exception (in wei precision).
    *   **maker**: Address of the maker associated with the offer.
* **timestamp**: Describes the time when the status of the current order changes.
Response Body:
```
{
    "result": boolean,
    "message": string
}
```

*   **result**: Boolean indicating the success or failure of processing the exception.
*   **message**: Additional information about the result (optional).

### Query API

This API endpoint is responsible for obtaining order information from market makers in the Tokenlon v6 system.

Endpoint: **GET /v6/marketmaker/status/{$chainId}**

Request Param:
```
    "requestId": uuid,
    "offerHash": string
```

*   **requestId**: Universally unique identifier (UUID) for the request.
*   **offerHash**: Hash of the RFQ offer.

Response Body:
```
{
    "makerToken": string,
    "takerToken": string,
    "makerTokenAmount": string,
    "takerTokenAmount": string,
    "requestId": uuid,
    "status": string,
    "txHash": string,
    "timestamp": number
}
```

*   **makerToken**: Address of the token being exchanged makerToken.
*   **takerToken**: Address of the token being exchanged takerToken.
*   **makerTokenAmount**: Total amount of maker token in the offer.
*   **takerTokenAmount**: Total amount of taker token in the offer.
*   **requestId**: Universally unique identifier (UUID) for the request.
*   **status**: The status of the current order: pending,success,failed,timeout.
*   **txHash**: TxHash of current order.
*   **timestamp**: Describes the time when the status of the current order changes.

Endpoint: **GET /v6/marketmaker/orders/{$chainId}**

Request Param:
```
    "makerAddress": string,
    "status": string
    "limit": string
    "offset": string
```

*   **makerAddress**: Address of the maker associated with the offer.
*   **status**: The status of the current order: pending,success,failed,timeout.
*   **limit**: Query order quantity limit.
*   **offset**: The starting position of the queried order.

Response Body:
```
[
    {
        "makerToken": string,
        "takerToken": string,
        "makerTokenAmount": string,
        "takerTokenAmount": string,
        "requestId": uuid,
        "status": string,
        "txHash": string,
        "timestamp": number
    },
    ...
]
```

*   **makerToken**: Address of the token being exchanged makerToken.
*   **takerToken**: Address of the token being exchanged takerToken.
*   **makerTokenAmount**: Total amount of maker token in the offer.
*   **takerTokenAmount**: Total amount of taker token in the offer.
*   **requestId**: Universally unique identifier (UUID) for the request.
*   **status**: The status of the current order: pending,success,failed,timeout.
*   **txHash**: TxHash of current order.
*   **timestamp**: Describes the time when the status of the current order changes.

**Complete Example, see [mock_mm_server.ts](/mock_mm_server.ts)**
