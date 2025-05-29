// Open edit modal with transaction details
function editTransaction(id) {
    const transaction = appData.transactions.find(t => t.id === id);
    if (transaction) {
        document.getElementById('editTransactionId').value = transaction.id;
        document.getElementById('editAmount').value = Math.abs(transaction.amount);
        document.getElementById('editDate').value = transaction.date;
        document.getElementById('editBlockHeight').value = transaction.blockHeight || '';
        document.getElementById('editDescription').value = transaction.description || '';

        // Show the modal
        document.getElementById('editTransactionModal').style.display = 'block';
    }
}

// Close edit modal
function closeEditModal() {
    document.getElementById('editTransactionModal').style.display = 'none';
}

// Save edited transaction
function saveEditedTransaction() {
    const id = parseInt(document.getElementById('editTransactionId').value);
    const amount = parseFloat(document.getElementById('editAmount').value);
    const date = document.getElementById('editDate').value;
    const blockHeight = document.getElementById('editBlockHeight').value;
    const description = document.getElementById('editDescription').value;

    const transactionIndex = appData.transactions.findIndex(t => t.id === id);
    if (transactionIndex !== -1) {
        const oldAmount = appData.transactions[transactionIndex].amount;
        appData.stack -= oldAmount;

        appData.transactions[transactionIndex] = {
            id: id,
            amount: appData.transactions[transactionIndex].type === 'add' ? amount : -amount,
            date: date,
            blockHeight: blockHeight ? parseInt(blockHeight) : null,
            description: description || '',
            type: appData.transactions[transactionIndex].type
        };

        appData.stack += appData.transactions[transactionIndex].amount;

        saveData();
        updateBTCDisplay();
        updateChart();
        updateTransactionHistory();
        updateEraStats();
        updateCarousel();

        closeEditModal();
        alert('Transaction mise à jour avec succès !');
    }
}
