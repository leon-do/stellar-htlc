/*
create(): radar creates a generic escrow address

buildFundEnvelope(): radar builds a fund transaction/envelope for user.

buildRefundEnvelope(): radar builds a refund transaction/envelope for user.

radar sends fundEnvelope and refundEnvelope to user

user checks envelope

signFundEnvelope(): if user agrees to fund, then user signs fundEnvelope and broadcasts it
  the generic escrow address then becomes a hash lock
  radar pays invoice, gets preimage
  claim(): radar gets preimage to claim XLM
  swap complete

signRefundEnvelope(): if user funds and shit goes wrong, then user can sign/broadcast the refund to get XLM back
  radar gets the inital fund from escrow address
  remainder gets sent back to user
*/


// https://gist.github.com/ctebbe/9590fecfb277c319a4547c2334b9759a
const stellarSdk = require("stellar-sdk")
stellarSdk.Network.useTestNetwork()
const blockchain = new stellarSdk.Server("https://horizon-testnet.stellar.org")


// https://portal.willet.io/
const serverKeyPair = stellarSdk.Keypair.fromSecret("SB3KVB6RN5MOJJUZFLRDZNWN67PZV6IF6L74PMSHJEXHX2ABVSJUZDVA")
console.log(serverKeyPair.publicKey())
// https://portal.willet.io/
const userKeyPair = stellarSdk.Keypair.fromSecret("SCV777PRFRSPCIIKENFCAIS4C5DLEFEI7Y236OXEXMCXL4FBLSAV3G65")
const userPubKey = 'GAN4MBSW4TPAJKQMEIJXKEUD4LHJDBHIC7ATYR2TGML2JJW3TWIY5Q6J'

const escrowPubKey = 'GBX2HD5H5CCSDEI6QAZVEMEP5TSAPGHJ3RED2QAIJY772N6KRKKP43UF'

const preimage = 'c104ac676ab0b9005222043de34195f6666d92382e1e161eac7c9358f6eddeb0'
const sha256HashOfPreimage = '685db6a78d5af37aae9cb7531ffc034444a562c774e54a73201cc17d7388fcbd'

start()
async function start() {

  // radar creates a generic account with some XLM
  const escrowPubKey = await create()
  console.log({escrowPubKey})

  // radar creates a transaction envelope for user to sign/fund escrow account
  const fundEnvelope = await buildFundEnvelope()
  console.log({fundEnvelope})

  const refundEnvelope = await buildRefundEnvelope()
  console.log({refundEnvelope})

  // user agrees and signs and broadcasts
  const fundedTransaction = await signFundEnvelope(userKeyPair, fundEnvelope)
  console.log({fundedTransaction})

  // shit went wrong
  const refundedTransaction = await signRefundEnvelope(userKeyPair, refundEnvelope)
  console.log({refundedTransaction})

  // // radar gets preimage and claims funds
  const claimedTransaction = await claim()
  console.log({claimedTransaction})
}

async function create() {
  // get server account info
  const serverAccount = await blockchain.loadAccount(serverKeyPair.publicKey())
  // create a completely new and unique pair of keys
  const escrowKeyPair = stellarSdk.Keypair.random()
  // https://www.stellar.org/developers/js-stellar-base/reference/base-examples.html#creating-an-account
  const transaction = new stellarSdk.TransactionBuilder(serverAccount)
  .addOperation(
    stellarSdk.Operation.createAccount({ 
      destination: escrowKeyPair.publicKey(), // create escrow account
      startingBalance: '2.00001' // 1 base + 0.5[base_reserve] per op(2) + tx fee (0.00001) => 2.00001 XLM minimum
    })
  )
  .addOperation(
    stellarSdk.Operation.setOptions({
      source: escrowKeyPair.publicKey(),   
      signer: {
        ed25519PublicKey: serverKeyPair.publicKey(), // add server as signer on escrow account
        weight: 1
      }
    })
  )
  .build()
  // sign transaction
  transaction.sign(serverKeyPair, escrowKeyPair)
  // broadcast transaction
  await blockchain.submitTransaction(transaction)
  return escrowKeyPair.publicKey()
}

async function buildFundEnvelope() {
  // load user account
  const userAccount = await blockchain.loadAccount(userPubKey)
  // add a payment operation to the transaction
  const transaction = new stellarSdk.TransactionBuilder(userAccount)
  .addOperation(
    stellarSdk.Operation.payment({
      destination: escrowPubKey, // user sends to escrow account
      asset: stellarSdk.Asset.native(), // native is XLM
      amount: '5'  // user pays 5 XLM
    })
  )
  .addOperation(
    stellarSdk.Operation.setOptions({
      source: escrowPubKey,   
      signer: {
        ed25519PublicKey: serverKeyPair.publicKey(), // add server as a signer on escrow account
        weight: 1
      }
    })
  )
  .addOperation(
    stellarSdk.Operation.setOptions({
      source: escrowPubKey,   
      signer: {
        ed25519PublicKey: userPubKey, // add user as a signer on escrow account
        weight: 1
      }
    })
  )
  .addOperation(
    stellarSdk.Operation.setOptions({
      source: escrowPubKey,
      signer: {
        sha256Hash: sha256HashOfPreimage, // hash taken from other chain. user has preimage
        weight: 1
      },
      masterWeight: 0, // escrow cannot sign its own txs
      lowThreshold: 2, // and add signing thresholds (2 of 3 signatures required)
      medThreshold: 2,
      highThreshold: 2
    })
  )
  .build()

  // sign transaction
  transaction.sign(serverKeyPair)
  // https://www.stellar.org/developers/js-stellar-sdk/reference/examples.html
  const fundEnvelope = transaction.toEnvelope().toXDR('base64') 
  return fundEnvelope 
}

async function buildRefundEnvelope() {
  // load escrow account from pub key
  const escrowAccount = await blockchain.loadAccount(escrowPubKey)
  // build claim transaction with timelock
  const tb = new stellarSdk.TransactionBuilder(escrowAccount, {
    timebounds: {
      minTime: Math.floor(Date.now() / 1000) + 3600, // this envelope is valid after 1 hour
      maxTime: 0
    }
  })
  .addOperation(
    stellarSdk.Operation.payment({
      destination: serverKeyPair.publicKey(),
      asset: stellarSdk.Asset.native(),
      amount: '2.00001' // send upfront cost back to server 
    }))
  .addOperation(
    stellarSdk.Operation.accountMerge({
      destination: userPubKey // merge remainder back to user
    }))

    // build and sign transaction
    const tx = tb.build()
    tx.sign(serverKeyPair)
    // https://www.stellar.org/developers/horizon/reference/xdr.html
    return tx.toEnvelope().toXDR('base64')
}

async function signRefundEnvelope(userKeyPair, envelope) {
  try {
    const txFromEnvelope = new stellarSdk.Transaction(envelope)
    txFromEnvelope.sign(userKeyPair)
    const resp = await server.submitTransaction(txFromEnvelope)
    return resp.hash
  } catch(err) {
    console.log('signed refund envelope failed')
    console.log(err)
  }
}

async function signFundEnvelope(keyPair, envelope) {
  try {
    const txFromEnvelope = new stellarSdk.Transaction(envelope)
    txFromEnvelope.sign(keyPair)
    const resp = await server.submitTransaction(txFromEnvelope)
    return resp.hash
  } catch(err) {
    console.log('signed fund envelope failed')
    console.log(err.response.data.extras)
  }
}

async function claim() {
  // load escrow account from pub key
  const escrowAccount = await blockchain.loadAccount(escrowPubKey)
  // build claim transaction
  const transaction = new stellarSdk.TransactionBuilder(escrowAccount)
  .addOperation(
    stellarSdk.Operation.accountMerge({
      destination: serverKeyPair.publicKey()
    })
  )
  .build()

  // sign transaction
  transaction.sign(serverKeyPair)
  // https://stellar.github.io/js-stellar-sdk/Transaction.html#signHashX
  transaction.signHashX(preimage)
  // broadcast transaction
  return await blockchain.submitTransaction(transaction)
}

function parseEnvelope() {
  const parsedFundEnvelope = new stellarSdk.Transaction('AAAAABvGBlbk3gSqDCITdRKD4s6RhOgXwTxHUzMXpKbbnZGOAAABkAAWaLEAAAABAAAAAAAAAAAAAAAEAAAAAAAAAAEAAAAAb6OPp+iFIZEegDNSMI/s5AeY6dxIPUAITj/9N8qKlP4AAAAAAAAAAAL68IAAAAABAAAAAG+jj6fohSGRHoAzUjCP7OQHmOncSD1ACE4//TfKipT+AAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAABULFTumx2A5/1HW/46H0B/J1p/DlV+I6T9rzltIA1iKAAAAAEAAAABAAAAAG+jj6fohSGRHoAzUjCP7OQHmOncSD1ACE4//TfKipT+AAAABQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAbxgZW5N4EqgwiE3USg+LOkYToF8E8R1MzF6Sm252RjgAAAAEAAAABAAAAAG+jj6fohSGRHoAzUjCP7OQHmOncSD1ACE4//TfKipT+AAAABQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAIAAAABAAAAAgAAAAEAAAACAAAAAAAAAAEAAAACaF22p41a83qunLdTH/wDRESlYsd05UpzIBzBfXOI/L0AAAABAAAAAAAAAAEgDWIoAAAAQPD47ZXcdLj7gAzL9/tIfuqM39U3jqL7UoDvMoFwtUIzuyOpy28UAB4MUSZsYpVqCDgDQOODm2ooWt567pWYTwA=')
  console.log(parsedFundEnvelope)

  const parsedRefundEnvelope = new stellarSdk.Transaction('AAAAAG+jj6fohSGRHoAzUjCP7OQHmOncSD1ACE4//TfKipT+AAAAyAAWV9kAAAABAAAAAQAAAABcKcYpAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAABAAAAAFQsVO6bHYDn/Udb/jofQH8nWn8OVX4jpP2vOW0gDWIoAAAAAAAAAAABMS1kAAAAAAAAAAgAAAAAG8YGVuTeBKoMIhN1EoPizpGE6BfBPEdTMxekptudkY4AAAAAAAAAASANYigAAABAeg6S5RusgUNg7rX2rCR7Jl0CiOs/nKSvz6FVhTRH7zwod9q07e1EMw89nkJ1lR1wVHpmYEaaVrEiPq/9ycScDQ')
  console.log(parsedRefundEnvelope)
}