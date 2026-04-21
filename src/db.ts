import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { defaultCategories, defaultSettings } from './data'
import type { BackupData, Category, Paycheck, RecurringBill, Settings, Transaction } from './types'

interface BudgetingDB extends DBSchema {
  transactions: {
    key: string
    value: Transaction
    indexes: {
      'by-date': string
      'by-category': string
    }
  }
  categories: {
    key: string
    value: Category
  }
  bills: {
    key: string
    value: RecurringBill
  }
  paychecks: {
    key: string
    value: Paycheck
  }
  settings: {
    key: string
    value: Settings
  }
}

let dbPromise: Promise<IDBPDatabase<BudgetingDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<BudgetingDB>('budgeting-app-db', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('transactions')) {
          const transactions = db.createObjectStore('transactions', { keyPath: 'id' })
          transactions.createIndex('by-date', 'date')
          transactions.createIndex('by-category', 'categoryId')
        }
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings')
        }
        if (!db.objectStoreNames.contains('bills')) {
          db.createObjectStore('bills', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('paychecks')) {
          db.createObjectStore('paychecks', { keyPath: 'id' })
        }
      },
    })
  }

  return dbPromise
}

export async function initDb() {
  const db = await getDb()
  const [categories, settings] = await Promise.all([db.getAll('categories'), db.get('settings', 'primary')])

  if (!categories.length) {
    const tx = db.transaction('categories', 'readwrite')
    await Promise.all(defaultCategories.map((category) => tx.store.put(category)))
    await tx.done
  }

  if (!settings) {
    await db.put('settings', defaultSettings, 'primary')
  }
}

export async function loadAll() {
  const db = await getDb()
  const [transactions, categories, bills, paychecks, settings] = await Promise.all([
    db.getAll('transactions'),
    db.getAll('categories'),
    db.getAll('bills'),
    db.getAll('paychecks'),
    db.get('settings', 'primary'),
  ])

  return {
    transactions: transactions.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    categories: categories.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    bills: bills
      .filter((bill) => bill.active)
      .sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name)),
    paychecks: paychecks.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    settings: settings ?? defaultSettings,
  }
}

export async function saveBills(bills: RecurringBill[]) {
  const db = await getDb()
  const tx = db.transaction('bills', 'readwrite')
  await tx.store.clear()
  await Promise.all(bills.map((bill) => tx.store.put(bill)))
  await tx.done
}

export async function saveTransaction(transaction: Transaction) {
  const db = await getDb()
  await db.put('transactions', transaction)
}

export async function deleteTransaction(id: string) {
  const db = await getDb()
  await db.delete('transactions', id)
}

export async function saveCategories(categories: Category[]) {
  const db = await getDb()
  const tx = db.transaction('categories', 'readwrite')
  await Promise.all(categories.map((category) => tx.store.put(category)))
  await tx.done
}

export async function saveBill(bill: RecurringBill) {
  const db = await getDb()
  await db.put('bills', bill)
}

export async function deleteBill(id: string) {
  const db = await getDb()
  await db.delete('bills', id)
}

export async function savePaycheck(paycheck: Paycheck) {
  const db = await getDb()
  await db.put('paychecks', paycheck)
}

export async function deletePaycheck(id: string) {
  const db = await getDb()
  await db.delete('paychecks', id)
}

export async function saveSettings(settings: Settings) {
  const db = await getDb()
  await db.put('settings', settings, 'primary')
}

export async function resetLocalData() {
  const db = await getDb()
  const tx = db.transaction(['transactions', 'categories', 'bills', 'paychecks', 'settings'], 'readwrite')
  await tx.objectStore('transactions').clear()
  await tx.objectStore('categories').clear()
  await tx.objectStore('bills').clear()
  await tx.objectStore('paychecks').clear()
  await Promise.all(defaultCategories.map((category) => tx.objectStore('categories').put(category)))
  await tx.objectStore('settings').put(defaultSettings, 'primary')
  await tx.done
}

export async function importBackup(data: BackupData) {
  const db = await getDb()
  const tx = db.transaction(['transactions', 'categories', 'bills', 'paychecks', 'settings'], 'readwrite')
  await tx.objectStore('transactions').clear()
  await tx.objectStore('categories').clear()
  await tx.objectStore('bills').clear()
  await tx.objectStore('paychecks').clear()
  await Promise.all(data.transactions.map((item) => tx.objectStore('transactions').put(item)))
  await Promise.all(data.categories.map((item) => tx.objectStore('categories').put(item)))
  await Promise.all(data.bills.map((item) => tx.objectStore('bills').put(item)))
  await Promise.all(data.paychecks.map((item) => tx.objectStore('paychecks').put(item)))
  await tx.objectStore('settings').put(data.settings, 'primary')
  await tx.done
}
