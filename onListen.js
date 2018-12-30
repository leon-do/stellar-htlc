var stellarSdk = require("stellar-sdk");
stellarSdk.Network.useTestNetwork();

class stellarChainFilter {
  constructor() {
    this.server = new stellarSdk.Server("https://horizon-testnet.stellar.org");
  }

  addAddressSubscription(address) {
    this.server.payments()
    .forAccount(address)
    .cursor('now')
    .stream({
      onmessage: function (message) {
        console.log(message);
      }
    })  
  }
}

const x = new stellarChainFilter
x.addAddressSubscription('GBYSLQL7EVMVURCQ6ZHLLAO4X5OITLDFMABFOK6CEU77LRAR2IGKFW5J')
x.addAddressSubscription('GABDEL5BUR3OZPUJV3XOGPNX7XGOUPLNJNKUK63FR7655U5C77H22NW2')


  /*
{ _links:
   { self:
      { href: 'https://horizon-testnet.stellar.org/operations/4615062618648577' },
     transaction:
      { href: 'https://horizon-testnet.stellar.org/transactions/e7823a6dad7b87d42e792bf2d65426d680cdf16068eef043ea1372546af99d9d' },
     effects:
      { href: 'https://horizon-testnet.stellar.org/operations/4615062618648577/effects' },
     succeeds:
      { href: 'https://horizon-testnet.stellar.org/effects?order=desc&cursor=4615062618648577' },
     precedes:
      { href: 'https://horizon-testnet.stellar.org/effects?order=asc&cursor=4615062618648577' } },
  id: '4615062618648577',
  paging_token: '4615062618648577',
  source_account: 'GCSU53P2B63KST65BAQHNSJRYBLEMGRVX56VKTRQLTP6UKQTLJKCJLXU',
  type: 'payment',
  type_i: 1,
  created_at: '2018-12-07T18:32:27Z',
  transaction_hash: 'e7823a6dad7b87d42e792bf2d65426d680cdf16068eef043ea1372546af99d9d',
  asset_type: 'native',
  from: 'GCSU53P2B63KST65BAQHNSJRYBLEMGRVX56VKTRQLTP6UKQTLJKCJLXU',
  to: 'GBYSLQL7EVMVURCQ6ZHLLAO4X5OITLDFMABFOK6CEU77LRAR2IGKFW5J',
  amount: '100.0000000',
  self: [Function],
  transaction: [Function],
  effects: [Function],
  succeeds: [Function],
  precedes: [Function] }
  */