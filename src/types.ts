export type View = 'home' | 'bills' | 'activity' | 'insights' | 'settings'
export type TransactionType = 'expense' | 'income'

export interface Transaction {
  id: string
  amount: number
  type: TransactionType
  categoryId: string
  merchant: string
  note: string
  date: string
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  monthlyBudget: number
  sortOrder: number
  archived: boolean
}

export interface Settings {
  currency: string
  locale: string
  theme: 'light' | 'dark'
  accentTheme: 'ocean' | 'emerald' | 'sunset' | 'rose' | 'custom'
  customAccent: string
  lastCutoffDate: string
  nextCutoffDate: string
  exportMetadata: {
    lastExportAt: string | null
    lastCloudSyncAt: string | null
  }
}

export interface CloudProfile {
  id: string
  email: string
  displayName: string
}

export interface RecurringBill {
  id: string
  name: string
  amount: number
  dueDay: number
  startDate: string
  payTiming: 'salary_day' | 'due_date'
  splitAcrossCutoffs: boolean
  totalOccurrences: number | null
  active: boolean
}

export interface Paycheck {
  id: string
  amount: number
  date: string
  cycleStart: string
  cycleEnd: string
  note: string
  createdAt: string
}

export interface BackupData {
  version: 1
  exportedAt: string
  settings: Settings
  categories: Category[]
  transactions: Transaction[]
  bills: RecurringBill[]
  paychecks: Paycheck[]
}

export interface MonthSummary {
  monthKey: string
  label: string
  totalSpent: number
  totalIncome: number
  totalBudget: number
  remaining: number
  categoryTotals: Record<string, number>
}

export interface CycleSummary {
  start: string
  end: string
  label: string
  actualPaycheck: number | null
  availableIncome: number | null
  billsReserved: number
  expensesLogged: number
  spendableAfterPlan: number | null
  spendableLeft: number | null
  dailyAllowance: number | null
  nextPaydayLabel: string
  daysLeft: number
  dueBills: Array<RecurringBill & { dueDate: string; reservedAmount: number; occurrenceNumber: number | null }>
}
