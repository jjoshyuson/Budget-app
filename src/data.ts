import type { Category, Settings } from './types'

export const defaultCategories: Category[] = [
  { id: 'food', name: 'Food', icon: 'utensils', color: '#3182ce', monthlyBudget: 18000, sortOrder: 0, archived: false },
  { id: 'transport', name: 'Transport', icon: 'route', color: '#2f855a', monthlyBudget: 7000, sortOrder: 1, archived: false },
  { id: 'home', name: 'Home', icon: 'home', color: '#805ad5', monthlyBudget: 12000, sortOrder: 2, archived: false },
  { id: 'shopping', name: 'Shopping', icon: 'bag', color: '#d69e2e', monthlyBudget: 9000, sortOrder: 3, archived: false },
  { id: 'health', name: 'Health', icon: 'heart', color: '#dd6b20', monthlyBudget: 6000, sortOrder: 4, archived: false },
  { id: 'fun', name: 'Fun', icon: 'spark', color: '#0f766e', monthlyBudget: 5000, sortOrder: 5, archived: false },
  { id: 'bills', name: 'Bills', icon: 'bolt', color: '#4a5568', monthlyBudget: 10000, sortOrder: 6, archived: false },
]

export const defaultSettings: Settings = {
  currency: 'PHP',
  locale: typeof navigator !== 'undefined' ? navigator.language : 'en-PH',
  theme: 'dark',
  accentTheme: 'ocean',
  customAccent: '#62b3ff',
  lastCutoffDate: '',
  nextCutoffDate: '',
  exportMetadata: {
    lastExportAt: null,
    lastCloudSyncAt: null,
  },
}
