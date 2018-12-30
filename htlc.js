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
var hashs = require("hash.js");
var stellarSdk = require("stellar-sdk");
stellarSdk.Network.useTestNetwork();
var server = new stellarSdk.Server("https://horizon-testnet.stellar.org");

start()
async function start() {
  // GC23CKKIREISXIU7CKPGADVJFWK4SNMZ2D6UCIEHZYXBYHQYNW4D34GL
  var radarKeyPair = stellarSdk.Keypair.fromSecret("SBSYUREAJRWRO6M2Z4MZD5222UITOD3O4MQLOF46K4UIGPNYF35MW2OK");
  // GABDEL5BUR3OZPUJV3XOGPNX7XGOUPLNJNKUK63FR7655U5C77H22NW2
  var userKeyPair = stellarSdk.Keypair.fromSecret("SDGQUQ2L7XENWCAJP5N65PJQJBNH3T5EIAFTY6B7DWI52EQMHYQGBZ6L");
  const userPubKey = userKeyPair.publicKey()

  const preimage = 'abc'

  // radar parses invoice to get hash
  const preimageBuffer = new Buffer(preimage, 'hex');
  const hashX = hashs.sha256().update(preimageBuffer).digest('hex');
  console.log({hashX})
  // radar creates a generic account with some XLM
  const escrowPubKey = await create(radarKeyPair)
  console.log({escrowPubKey})

  // radar creates a transaction envelope for user to sign/fund escrow account
  const fundEnvelope = await buildFundEnvelope(radarKeyPair, escrowPubKey, userPubKey, '5', hashX)
  console.log({fundEnvelope})

  const refundEnvelope = await buildRefundEnvelope(radarKeyPair, escrowPubKey, userPubKey)
  console.log({refundEnvelope})

  // user agrees and signs and broadcasts
  const fundedTransaction = await signFundEnvelope(userKeyPair, fundEnvelope)
  console.log({fundedTransaction})

  await delay(10000)

  // // shit went wrong
  // const refundedTransaction = await signRefundEnvelope(userKeyPair, refundEnvelope)
  // console.log({refundedTransaction})

  // // radar gets preimage and claims funds
  // const claimedTransaction = await claim(radarKeyPair, escrowPubKey, preimage)
  // console.log({claimedTransaction})
}

async function create(keyPair) {
  // create a completely new and unique pair of keys
  var escrowKeyPair = stellarSdk.Keypair.random();
  const userAccount = await server.loadAccount(keyPair.publicKey());
  // build transaction with operations
  const tb = new stellarSdk.TransactionBuilder(userAccount)
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
        ed25519PublicKey: keyPair.publicKey(), // add radar as signer on escrow account
        weight: 1
      }
    })
  )

  try {
    // build and sign transaction
    const tx = tb.build();
    tx.sign(escrowKeyPair);
    tx.sign(keyPair);
    // broadcast transaction
    await server.submitTransaction(tx);
    return tx.operations[0].destination
  } catch (err) {
    console.log("escrow transaction failed");
    console.log(err.response.data.extras);
  }
}

async function buildFundEnvelope(keyPair, escrowPubKey, userPubKey, amount, hashX) {
  // load account to sign with
  const account = await server.loadAccount(userPubKey);
  // add a payment operation to the transaction
  const tb = new stellarSdk.TransactionBuilder(account)
  .addOperation(
    stellarSdk.Operation.payment({
      destination: escrowPubKey,
      asset: stellarSdk.Asset.native(),
      amount: amount  // user pays amount
    }))
  .addOperation(
    stellarSdk.Operation.setOptions({
      source: escrowPubKey,   
      signer: {
        ed25519PublicKey: keyPair.publicKey(), // add radar as signer on escrow account
        weight: 1
      }
    }))
  .addOperation(
    stellarSdk.Operation.setOptions({
      source: escrowPubKey,   
      signer: {
        ed25519PublicKey: userPubKey, // add user as signer on escrow account
        weight: 1
      }
    }))
  .addOperation(
    stellarSdk.Operation.setOptions({
      source: escrowPubKey,
      signer: {
        sha256Hash: hashX, // add hash(x) as signer on escrow acount
        weight: 1
      },
      masterWeight: 0, // escrow cannot sign its own txs
      lowThreshold: 2, // and add signing thresholds (2 signatures required)
      medThreshold: 2,
      highThreshold: 2
    }));

  try {
    // build and sign transaction
    const tx = tb.build();
    tx.sign(keyPair);
    return tx.toEnvelope().toXDR('base64')
  } catch (err) {
    console.log("escrow transaction failed");
    console.log(err.response.data.extras);
  }
}

async function buildRefundEnvelope(keyPair, escrowPubKey, userPubKey) {
  // load escrow account from pub key
  const escrowAccount = await server.loadAccount(escrowPubKey);
  // load all payments
  const escrowPayments = await escrowAccount.payments()
  // build claim transaction with timelock
  const tb = new stellarSdk.TransactionBuilder(escrowAccount, {
    timebounds: {
      minTime: Math.floor(Date.now() / 1000) + 2, // timelock of 2 seconds
      maxTime: 0
    }
  })
  .addOperation(
    stellarSdk.Operation.payment({
      destination: keyPair.publicKey(),
      asset: stellarSdk.Asset.native(),
      amount: escrowPayments.records[0].starting_balance // send upfront cost back to radar
    }))
  .addOperation(
    stellarSdk.Operation.accountMerge({
      destination: userPubKey // merge remainder back to user
    }));

  try {
    // build and sign transaction
    const tx = tb.build();
    tx.sign(keyPair);
    // https://www.stellar.org/developers/horizon/reference/xdr.html
    return tx.toEnvelope().toXDR('base64')
  } catch (err) {
    console.log("claim transaction failed");
    console.log(err.response.data.extras);
  }
}

async function signRefundEnvelope(userKeyPair, envelope) {
  try {
    const txFromEnvelope = new stellarSdk.Transaction(envelope);
    txFromEnvelope.sign(userKeyPair)
    const resp = await server.submitTransaction(txFromEnvelope);
    return resp.hash
  } catch(err) {
    console.log('signed refund envelope failed')
    console.log(err)
  }
}

async function signFundEnvelope(keyPair, envelope) {
  try {
    const txFromEnvelope = new stellarSdk.Transaction(envelope);
    txFromEnvelope.sign(keyPair);
    const resp = await server.submitTransaction(txFromEnvelope);
    return resp.hash
  } catch(err) {
    console.log('signed fund envelope failed')
    console.log(err.response.data.extras)
  }
}

async function claim(keyPair, escrowPubKey, preimage) {
  // load escrow account from pub key
  const escrowAccount = await server.loadAccount(escrowPubKey);
  // build claim transaction
  const tb = new stellarSdk.TransactionBuilder(escrowAccount)
  .addOperation(
    stellarSdk.Operation.accountMerge({
      destination: keyPair.publicKey()
    }));

  try {
    // build and sign transaction
    const tx = tb.build();
    tx.sign(keyPair);
    // https://stellar.github.io/js-stellar-sdk/Transaction.html#signHashX
    tx.signHashX(preimage);
    // broadcast transaction
    return await server.submitTransaction(tx);
  } catch (err) {
    console.log("claim transaction failed");
    console.log(err.response.data.extras);
  }
}

function delay(ms) {
  return new Promise(res => {
    setTimeout(() => {
      res(true)
    }, ms)
  })
}