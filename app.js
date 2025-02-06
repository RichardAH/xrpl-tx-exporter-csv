const Client = require('rippled-ws-client')
const {parseBalanceChanges} = require('ripple-lib-transactionparser')

const app = async (account, cb) => {
  console.error('Starting transaction trace for account:', account)
  
  const client = await new Client('wss://xahau.network', {
    NoUserAgent: true
  })
  console.error('Connected to WebSocket')

  // Print CSV header to stdout
  console.log('Date,Sent Amount,Sent Currency,Received Amount,Received Currency,Fee Amount,Fee Currency,Net Worth Amount,Net Worth Currency,Label,Description,TxHash')

  const processTransaction = async (txHash, ledgerIndex) => {
    console.error(`\nProcessing transaction: ${txHash} from ledger: ${ledgerIndex}`)
    
    // Get ledger close time
    console.error('Fetching ledger info...')
    const ledgerInfo = await client.send({
      command: 'ledger',
      ledger_index: ledgerIndex
    })
    console.error('Ledger info response:', JSON.stringify(ledgerInfo, null, 2))
    
    // Get transaction details
    console.error('Fetching transaction details...')
    const txInfo = await client.send({
      command: 'tx',
      transaction: txHash
    })
    console.error('Transaction info response:', JSON.stringify(txInfo, null, 2))

    if (txInfo) {
      console.error('Processing transaction result...')
      const {meta, hash} = txInfo
      const tx = txInfo
      const closeTime = ledgerInfo?.ledger?.close_time || 0
      const date = new Date((closeTime - 1 + 946684800) * 1000)
      const formattedDate = date.toISOString().replace('T', ' ').replace('.000Z', ' UTC')
      
      console.error('Parsing balance changes...')
      const balanceChanges = parseBalanceChanges(meta)
      console.error('Balance changes:', JSON.stringify(balanceChanges, null, 2))
      
      if (Object.keys(balanceChanges).indexOf(account) > -1) {
        console.error('Found balance changes for account')
        const mutations = balanceChanges[account]
        
        let sentAmount = ''
        let sentCurrency = ''
        let receivedAmount = ''
        let receivedCurrency = ''
        // Set fee amount if this account initiated the transaction
        let feeAmount = tx?.Account === account ? (Number(tx.Fee) / 1000000).toFixed(6) : ''
        
        mutations.forEach(mutation => {
          console.error('Processing mutation:', JSON.stringify(mutation, null, 2))
          
          // Format currency - use simple XAH for native currency, otherwise use token:issuer format
          const currency = mutation.counterparty === '' 
            ? 'XAH'
            : `${mutation.currency}:${mutation.counterparty}`
            
          const amount = Math.abs(Number(mutation.value))
          
          if (Number(mutation.value) < 0) {
            // For sent amounts, subtract the fee if this account initiated the transaction
            const sentAmountValue = amount - (tx?.Account === account ? Number(tx.Fee) / 1000000 : 0)
            sentAmount = sentAmountValue.toFixed(6)
            sentCurrency = currency
          } else {
            // Received amount
            receivedAmount = amount
            receivedCurrency = currency
          }
        })
        
        // Special handling for transaction types
        let label = ''
        if (tx.TransactionType === 'Payment') {
          if (receivedAmount && !sentAmount) {
            label = 'mining' // Genesis mint or reward
          }
        }
        
        // Output the transaction
        console.log(`${formattedDate},${sentAmount},${sentCurrency},${receivedAmount},${receivedCurrency},${feeAmount},XAH,,,${label},${tx.TransactionType},${hash}`)
      } else {
        console.error('No balance changes found for account')
      }
    } else {
      console.error('No transaction result found')
    }
  }

  // Start with current ledger
  let currentLedger = 'current'
  
  while (true) {
    try {
      console.error(`\nQuerying account_info for ledger: ${currentLedger}`)
      const accountInfo = await client.send({
        command: 'account_info',
        account: account,
        ledger_index: currentLedger
      })
      console.error('Account info response:', JSON.stringify(accountInfo, null, 2))

      // Check if we have an error response
      if (accountInfo.error) {
        console.error('Received error response:', accountInfo.error)
        break
      }

      // Check if we have the account data
      if (!accountInfo.account_data) {
        console.error('No account data found in response')
        break
      }

      const txId = accountInfo.account_data.PreviousTxnID
      const ledgerSeq = accountInfo.account_data.PreviousTxnLgrSeq
      console.error(`Found previous transaction: ${txId} in ledger: ${ledgerSeq}`)

      await processTransaction(txId, ledgerSeq)

      if (!ledgerSeq || ledgerSeq === 0) {
        console.error('Reached ledger 0 or null ledger sequence, breaking loop')
        break
      }
      currentLedger = ledgerSeq - 1
      console.error(`Next query will use ledger: ${currentLedger}`)

      // Add small delay
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (error) {
      console.error('Error in main processing loop:', error)
      console.error('Error stack:', error.stack)
      break
    }
  }

  console.error('Closing WebSocket connection')
  client.close()
}

const fields = [
  'Date',
  'Sent Amount',
  'Sent Currency',
  'Received Amount',
  'Received Currency',
  'Fee Amount',
  'Fee Currency',
  'Net Worth Amount',
  'Net Worth Currency',
  'Label',
  'Description',
  'TxHash'
]

module.exports = {
  app,
  fields
}
