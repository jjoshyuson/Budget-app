import './style.css'
import heroImage from './assets/hero.png'
import {
  getCurrentCloudProfile,
  isCloudConfigured,
  listenToAuthChanges,
  loadCloudSnapshot,
  saveCloudSnapshot,
  signInWithEmail,
  signOutCloud,
  signUpWithEmail,
  updateCloudProfile,
} from './cloud'
import { defaultSettings } from './data'
import {
  deleteBill,
  deletePaycheck,
  deleteTransaction,
  importBackup,
  initDb,
  loadAll,
  saveBill,
  saveCategories,
  savePaycheck,
  saveSettings,
  saveTransaction,
} from './db'
import type {
  BackupData,
  Category,
  CloudProfile,
  CycleSummary,
  MonthSummary,
  Paycheck,
  RecurringBill,
  Settings,
  Transaction,
  TransactionType,
  View,
} from './types'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const rootElement = document.querySelector<HTMLDivElement>('#app')

if (!rootElement) {
  throw new Error('App root not found')
}

const root: HTMLDivElement = rootElement
const cloudConfigured = isCloudConfigured()
let cloudSyncTimer: number | null = null
let authUnsubscribe: (() => void) | null = null

const state = {
  ready: false,
  view: 'home' as View,
  transactions: [] as Transaction[],
  categories: [] as Category[],
  bills: [] as RecurringBill[],
  paychecks: [] as Paycheck[],
  settings: defaultSettings as Settings,
  search: '',
  quickAddOpen: false,
  quickAddExpanded: false,
  amountInput: '',
  quickType: 'expense' as TransactionType,
  quickCategoryId: '',
  quickMerchant: '',
  quickNote: '',
  quickDate: todayIso(),
  editingTransactionId: null as string | null,
  installPrompt: null as InstallPromptEvent | null,
  toast: '',
  toastTimer: 0 as number,
  billModalOpen: false,
  paycheckModalOpen: false,
  editingLastCutoff: false,
  expandedBillId: null as string | null,
  authReady: false,
  user: null as CloudProfile | null,
  authMode: 'sign_in' as 'sign_in' | 'sign_up',
  authBusy: false,
  authError: '',
  syncStatus: cloudConfigured ? 'idle' as 'idle' | 'syncing' | 'synced' | 'offline' | 'error' : 'local',
  syncMessage: cloudConfigured ? 'Cloud sync not connected yet.' : 'Local-only mode',
  authDraft: {
    displayName: '',
    email: '',
    password: '',
  },
  billDraft: {
    name: '',
    amount: '',
    dueDay: '',
    startDate: todayIso(),
    splitAcrossCutoffs: false,
    splitSecondDate: '',
    totalOccurrences: null as number | null,
    recurrenceType: 'recurring' as 'one_time' | 'recurring',
    recurrenceMode: 'indefinite' as 'indefinite' | 'custom',
    customOccurrences: '',
  },
  paycheckDraft: {
    amount: '',
    date: todayIso(),
    note: '',
  },
}

void bootstrap()

async function bootstrap() {
  await initDb()
  await refreshData()
  await initializeCloud()
  bindGlobalEvents()
  applyTheme()
  render()
  registerServiceWorker()
}

async function refreshData() {
  const { transactions, categories, bills, paychecks, settings } = await loadAll()
  state.transactions = transactions
  state.categories = categories
  state.bills = bills.map((bill) => ({
    ...bill,
    startDate: bill.startDate || todayIso(),
    splitAcrossCutoffs: bill.splitAcrossCutoffs ?? false,
    totalOccurrences: bill.totalOccurrences ?? null,
  }))
  state.paychecks = paychecks
  state.settings = { ...defaultSettings, ...settings }
  if (!state.settings.nextCutoffDate) {
    state.settings.nextCutoffDate = defaultNextCutoffDate()
  }
  if (!state.settings.lastCutoffDate) {
    state.settings.lastCutoffDate = defaultLastCutoffDate(state.settings.nextCutoffDate)
  }
  if (!state.quickCategoryId && categories.length) {
    state.quickCategoryId = categories[0].id
  }
  state.ready = true
}

async function initializeCloud() {
  state.authReady = !cloudConfigured
  if (!cloudConfigured) return

  try {
    state.user = await getCurrentCloudProfile()
    state.authReady = true
    if (state.user) {
      state.authDraft.displayName = state.user.displayName
      await hydrateFromCloudIfNeeded()
    }
  } catch (error) {
    state.authReady = true
    state.syncStatus = 'error'
    state.syncMessage = error instanceof Error ? error.message : 'Cloud setup still needs finishing.'
  }

  authUnsubscribe?.()
  authUnsubscribe = listenToAuthChanges((profile, event) => {
    state.user = profile
    state.authReady = true
    state.authBusy = false
    state.authError = ''
    state.authDraft.password = ''
    if (profile) {
      state.authDraft.displayName = profile.displayName
      state.authDraft.email = profile.email
      state.syncStatus = navigator.onLine ? 'synced' : 'offline'
      state.syncMessage = navigator.onLine ? 'Cloud account connected.' : 'Offline right now. Changes will sync later.'
      void hydrateFromCloudIfNeeded()
    } else {
      state.syncStatus = 'idle'
      state.syncMessage = 'Cloud sync not connected yet.'
    }
    if (event !== 'INITIAL_SESSION') {
      render()
    }
  })

  window.addEventListener('online', () => {
    if (!cloudConfigured) return
    state.syncStatus = state.user ? 'syncing' : 'idle'
    state.syncMessage = state.user ? 'Back online. Syncing your data...' : 'Back online.'
    if (state.user) {
      queueCloudSync()
    }
    render()
  })

  window.addEventListener('offline', () => {
    if (!cloudConfigured) return
    state.syncStatus = state.user ? 'offline' : 'idle'
    state.syncMessage = state.user ? 'Offline. Local changes stay on this device until you reconnect.' : 'Offline.'
    render()
  })
}

function bindGlobalEvents() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    state.installPrompt = event as InstallPromptEvent
    render()
  })

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const actionTarget = target.closest<HTMLElement>('[data-action]')
    if (!actionTarget) return

    const action = actionTarget.dataset.action
    if (!action) return

    void handleAction(action, actionTarget)
  })

  root.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement
    const field = target.dataset.field
    if (!field) return

    switch (field) {
      case 'search':
        state.search = target.value
        break
      case 'quick-merchant':
        state.quickMerchant = target.value
        break
      case 'quick-note':
        state.quickNote = target.value
        break
      case 'quick-date':
        state.quickDate = target.value
        break
      case 'currency':
        state.settings.currency = target.value.toUpperCase()
        break
      case 'locale':
        state.settings.locale = target.value
        break
      case 'custom-accent':
        state.settings.customAccent = target.value
        state.settings.accentTheme = 'custom'
        applyTheme()
        break
      case 'last-cutoff-date':
        state.settings.lastCutoffDate = target.value
        break
      case 'next-cutoff-date':
        state.settings.nextCutoffDate = target.value
        break
      case 'auth-display-name':
        state.authDraft.displayName = target.value
        break
      case 'auth-email':
        state.authDraft.email = target.value
        break
      case 'auth-password':
        state.authDraft.password = target.value
        break
      case 'bill-name':
        state.billDraft.name = target.value
        break
      case 'bill-amount':
        state.billDraft.amount = target.value
        break
      case 'bill-due-day':
        state.billDraft.dueDay = target.value
        break
      case 'bill-start-date':
        state.billDraft.startDate = target.value
        if (state.billDraft.splitAcrossCutoffs && !state.billDraft.splitSecondDate) {
          state.billDraft.splitSecondDate = target.value
        }
        break
      case 'bill-split-second-date':
        state.billDraft.splitSecondDate = target.value
        break
      case 'bill-custom-occurrences':
        state.billDraft.customOccurrences = target.value
        break
      case 'paycheck-amount':
        state.paycheckDraft.amount = target.value
        break
      case 'paycheck-date':
        state.paycheckDraft.date = target.value
        break
      case 'paycheck-note':
        state.paycheckDraft.note = target.value
        break
      default:
        if (field.startsWith('budget-')) {
          const categoryId = field.replace('budget-', '')
          updateCategoryDraft(categoryId, Number(target.value))
        }
        break
    }

    render()
  })

  root.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement
    const field = target.dataset.field
    if (target instanceof HTMLInputElement && target.id === 'import-backup-input' && target.files?.[0]) {
      void importBackupFile(target.files[0])
      return
    }

    if (!field) return

    if (field === 'custom-accent') {
      state.settings.customAccent = target.value
      state.settings.accentTheme = 'custom'
      applyTheme()
      void saveSettings(state.settings)
      queueCloudSync()
      render()
      return
    }

  })
}

async function handleAction(action: string, source: HTMLElement) {
  switch (action) {
    case 'switch-view':
      state.view = (source.dataset.view as View) || 'home'
      state.quickAddOpen = false
      render()
      break
    case 'open-settings':
      state.view = 'settings'
      render()
      break
    case 'open-bill-modal':
      state.billModalOpen = true
      render()
      break
    case 'close-bill-modal':
      state.billModalOpen = false
      render()
      break
    case 'open-paycheck-modal':
      state.paycheckModalOpen = true
      if (!state.paycheckDraft.date) state.paycheckDraft.date = todayIso()
      render()
      break
    case 'close-paycheck-modal':
      state.paycheckModalOpen = false
      render()
      break
    case 'toggle-last-cutoff-edit':
      state.editingLastCutoff = !state.editingLastCutoff
      render()
      break
    case 'set-auth-mode':
      state.authMode = (source.dataset.authMode as 'sign_in' | 'sign_up') || 'sign_in'
      state.authError = ''
      if (state.authMode === 'sign_in') {
        state.authDraft.displayName = state.user?.displayName || state.authDraft.displayName
      }
      render()
      break
    case 'toggle-bill-split':
      state.billDraft.splitAcrossCutoffs = !state.billDraft.splitAcrossCutoffs
      if (state.billDraft.splitAcrossCutoffs && !state.billDraft.splitSecondDate) {
        state.billDraft.splitSecondDate = state.billDraft.startDate || todayIso()
      }
      if (!state.billDraft.splitAcrossCutoffs) {
        state.billDraft.splitSecondDate = ''
      }
      render()
      break
    case 'set-bill-recurrence-type':
      state.billDraft.recurrenceType = (source.dataset.recurrenceType as 'one_time' | 'recurring') || 'recurring'
      if (state.billDraft.recurrenceType === 'one_time') {
        state.billDraft.recurrenceMode = 'custom'
        state.billDraft.customOccurrences = '1'
      } else if (!state.billDraft.customOccurrences || state.billDraft.customOccurrences === '1') {
        state.billDraft.recurrenceMode = 'indefinite'
        state.billDraft.customOccurrences = ''
      }
      render()
      break
    case 'set-bill-recurrence-mode':
      state.billDraft.recurrenceMode = (source.dataset.recurrenceMode as 'indefinite' | 'custom') || 'indefinite'
      if (state.billDraft.recurrenceMode === 'custom' && !state.billDraft.customOccurrences) {
        state.billDraft.customOccurrences = '12'
      }
      if (state.billDraft.recurrenceMode === 'indefinite') {
        state.billDraft.customOccurrences = ''
      }
      render()
      break
    case 'toggle-bill-card':
      state.expandedBillId = state.expandedBillId === (source.dataset.billId || null) ? null : (source.dataset.billId || null)
      render()
      break
    case 'open-quick-add':
      openQuickAdd()
      render()
      break
    case 'close-quick-add':
      closeQuickAdd()
      render()
      break
    case 'toggle-details':
      state.quickAddExpanded = !state.quickAddExpanded
      render()
      break
    case 'set-quick-type':
      state.quickType = (source.dataset.type as TransactionType) || 'expense'
      render()
      break
    case 'set-quick-category':
      state.quickCategoryId = source.dataset.categoryId || state.quickCategoryId
      render()
      break
    case 'key':
      updateAmountInput(source.dataset.value || '')
      render()
      break
    case 'save-transaction':
      await commitQuickAdd()
      break
    case 'edit-transaction':
      startEditing(source.dataset.transactionId || '')
      render()
      break
    case 'delete-transaction':
      await removeTransaction(source.dataset.transactionId || '')
      break
    case 'save-settings':
      await persistSettings()
      break
    case 'submit-auth':
      await submitAuth()
      break
    case 'sign-out':
      await signOutUser()
      break
    case 'update-profile':
      await saveProfile()
      break
    case 'sync-cloud-now':
      await syncCloudNow()
      break
    case 'save-categories':
      await persistCategories()
      break
    case 'add-bill':
      await addBill()
      break
    case 'delete-bill':
      await removeBill(source.dataset.billId || '')
      break
    case 'log-paycheck':
      await logPaycheck()
      break
    case 'delete-paycheck':
      await removePaycheck(source.dataset.paycheckId || '')
      break
    case 'export-backup':
      await exportBackup()
      break
    case 'trigger-import':
      document.getElementById('import-backup-input')?.click()
      break
    case 'install-app':
      await promptInstall()
      break
    case 'set-theme':
      state.settings.theme = (source.dataset.theme as Settings['theme']) || 'dark'
      applyTheme()
      await saveSettings(state.settings)
      queueCloudSync()
      render()
      break
    case 'set-accent-theme':
      state.settings.accentTheme = (source.dataset.accentTheme as Settings['accentTheme']) || 'ocean'
      applyTheme()
      await saveSettings(state.settings)
      queueCloudSync()
      render()
      break
    default:
      break
  }
}

function render() {
  const focus = captureFocus()
  const cycle = getCurrentCycleSummary()
  const summary = getCurrentMonthSummary()
  const filteredTransactions = getFilteredTransactions()

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">Pocket Budget</p>
          <h1>Cutoff Budget</h1>
        </div>
        <div class="topbar-actions">
          ${renderSyncBadge()}
          <button class="icon-button" data-action="open-settings" aria-label="Open settings">
            ${renderIcon('gear')}
          </button>
        </div>
      </header>

      <main class="main-content">
        ${renderCurrentView(cycle, summary, filteredTransactions)}
      </main>

      <nav class="bottom-nav" aria-label="Primary">
        ${renderNavButton('home', 'Home')}
        ${renderNavButton('bills', 'Bills')}
        <button class="add-button" data-action="open-quick-add" aria-label="Add expense">
          ${renderIcon('plus')}
        </button>
        ${renderNavButton('insights', 'Runway')}
        ${renderNavButton('settings', 'Settings')}
      </nav>

      ${state.quickAddOpen ? renderQuickAdd(cycle) : ''}
      ${state.billModalOpen ? renderBillComposer() : ''}
      ${state.paycheckModalOpen ? renderPaycheckComposer() : ''}
      ${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ''}
    </div>
  `

  restoreFocus(focus)
}

function renderCurrentView(cycle: CycleSummary, summary: MonthSummary, filteredTransactions: Transaction[]) {
  switch (state.view) {
    case 'home':
      return renderHome(cycle)
    case 'bills':
      return renderBills(cycle)
    case 'activity':
      return renderActivity(filteredTransactions)
    case 'insights':
      return renderInsights(cycle, summary)
    case 'settings':
      return renderSettings()
    default:
      return ''
  }
}

function renderHome(cycle: CycleSummary) {
  const actualIncomeLabel = cycle.actualPaycheck !== null ? formatCurrency(cycle.actualPaycheck) : 'Not logged yet'

  const allowance = cycle.dailyAllowance !== null ? formatCurrency(cycle.dailyAllowance) : 'Input net pay'
  const left = cycle.spendableLeft !== null ? formatCurrency(cycle.spendableLeft) : 'Input net pay'
  const nextDueBill = cycle.dueBills[0] ?? null
  const latestTransactions = state.transactions.filter((item) => item.type === 'expense').slice(0, 5)

  return `
    <section class="dashboard-hero">
      <div class="hero-grid">
        <article class="premium-card highlight-card">
          <div class="section-header compact">
            <div>
              <p class="muted-label">Safe to spend</p>
              <h3>${left}</h3>
            </div>
            <span class="status-pill">${cycle.daysLeft} day${cycle.daysLeft === 1 ? '' : 's'} left</span>
          </div>
          <p>${cycle.actualPaycheck !== null ? 'After bills due this cutoff and logged expenses.' : 'Input your net pay to calculate the real number.'}</p>
          <div class="metric-strip">
            <div>
              <span>Daily target</span>
              <strong>${allowance}</strong>
            </div>
            <div>
              <span>Bills this cutoff</span>
              <strong>${formatCurrency(cycle.billsReserved)}</strong>
            </div>
          </div>
          <div class="button-row hero-actions">
            <button class="primary-button" data-action="${cycle.actualPaycheck !== null ? 'open-quick-add' : 'open-paycheck-modal'}">${cycle.actualPaycheck !== null ? 'Quick add expense' : 'Input net pay'}</button>
            <button class="ghost-button" data-action="switch-view" data-view="bills">Open bills</button>
          </div>
        </article>

        <article class="premium-card">
          <p class="muted-label">Net pay</p>
          <h3>${actualIncomeLabel}</h3>
          <p>${cycle.actualPaycheck !== null ? 'Actual income logged for this cutoff.' : 'No net pay recorded yet for this cutoff.'}</p>
        </article>

        <article class="premium-card">
          <p class="muted-label">Next bill</p>
          <h3>${nextDueBill ? escapeHtml(nextDueBill.name) : 'No bill due'}</h3>
          <p>${nextDueBill ? `Due ${formatShortDate(nextDueBill.dueDate)} for ${formatCurrency(nextDueBill.amount)}` : `Nothing due before ${escapeHtml(cycle.nextPaydayLabel)}.`}</p>
        </article>

        <article class="premium-card">
          <p class="muted-label">Next cutoff</p>
          <h3>${escapeHtml(cycle.nextPaydayLabel)}</h3>
          <p>${escapeHtml(cycle.label)}</p>
        </article>
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <p class="muted-label">This cycle</p>
          <h3>What gets reserved first</h3>
        </div>
        <button class="ghost-button" data-action="switch-view" data-view="bills">Open bills</button>
      </div>

      <div class="plan-list">
        ${cycle.dueBills.length
          ? cycle.dueBills
              .map(
                (bill) => `
                  <article class="plan-row">
                    <div class="plan-main">
                      <span class="plan-icon">${renderIcon('bill')}</span>
                      <div>
                        <strong>${escapeHtml(bill.name)}</strong>
                        <p>Due ${formatShortDate(bill.dueDate)} | ${bill.splitAcrossCutoffs ? 'split across 2 cutoffs' : 'single cutoff'} | reserved now ${formatCurrency(bill.reservedAmount)}</p>
                      </div>
                    </div>
                    <strong>${formatCurrency(bill.amount)}</strong>
                  </article>
                `,
              )
              .join('')
          : `
            <article class="plan-row empty-plan">
              <div>
                <strong>No recurring bills set yet</strong>
                <p>Add your fixed payments and the app will reserve them every cycle.</p>
              </div>
            </article>
          `}
      </div>
    </section>

    <section class="section">
      <div class="section-header">
        <div>
          <p class="muted-label">Recent expenses</p>
          <h3>Keep the runway honest</h3>
        </div>
        <button class="ghost-button" data-action="switch-view" data-view="activity">See all</button>
      </div>
      ${latestTransactions.length ? renderTransactionList(latestTransactions) : renderEmptyState()}
    </section>
  `
}

function renderBills(cycle: CycleSummary) {
  const dueBills = cycle.dueBills
  const activeBills = [...state.bills].sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name))

  return `
    <section class="section stack bills-screen">
      <div class="bills-toolbar">
        <button class="bills-add-widget" data-action="open-bill-modal" aria-label="Add bill">
          <span class="bills-add-icon">${renderIcon('plus')}</span>
          <span>Add bill</span>
        </button>
      </div>

      <div class="bill-list">
        ${activeBills.map((bill) => renderBillCard(bill, dueBills)).join('')}
      </div>
    </section>
  `
}

function renderBillCard(
  bill: RecurringBill,
  dueBills: CycleSummary['dueBills'],
) {
  const currentCycleDue = dueBills.find((item) => item.id === bill.id)
  const upcoming = getBillPreview(bill)
  const expanded = state.expandedBillId === bill.id
  const statusLabel = currentCycleDue ? 'Due this cutoff' : upcoming.status
  const dueLabel = currentCycleDue ? formatLongDate(currentCycleDue.dueDate) : upcoming.label
  const reservedLabel = currentCycleDue
    ? `Reserved now ${formatCurrency(currentCycleDue.reservedAmount)}`
    : bill.splitAcrossCutoffs
      ? 'Split across 2 cutoffs'
      : 'Single cutoff'
  const termLabel =
    bill.totalOccurrences === 1
      ? 'One time'
      : bill.totalOccurrences === null
      ? 'Indefinite'
      : `${Math.max(bill.totalOccurrences - (currentCycleDue?.occurrenceNumber ?? upcoming.occurrenceNumber ?? 0) + 1, 0)} left`

  return `
    <article class="bill-card bill-card-clean ${expanded ? 'is-expanded' : ''}">
      <button class="bill-card-toggle" data-action="toggle-bill-card" data-bill-id="${bill.id}" aria-expanded="${expanded ? 'true' : 'false'}">
        <span class="bill-logo">${escapeHtml(bill.name.charAt(0).toUpperCase())}</span>
        <div class="bill-copy">
          <div class="bill-copy-head">
            <div class="bill-title-group">
              <strong>${escapeHtml(bill.name)}</strong>
              <p class="bill-due-line">Due ${escapeHtml(dueLabel)}</p>
            </div>
            <span class="bill-amount">${formatCurrency(bill.amount)}</span>
          </div>
        </div>
      </button>
      ${
        expanded
          ? `
            <div class="row-actions bill-row-actions">
              <span class="status-pill ${currentCycleDue ? 'warn' : 'ok'}">${escapeHtml(statusLabel)}</span>
              <span class="bill-meta-line">${escapeHtml(reservedLabel)} | ${escapeHtml(termLabel)}</span>
              <button class="ghost-button danger" data-action="delete-bill" data-bill-id="${bill.id}">Delete</button>
            </div>
          `
          : ''
      }
    </article>
  `
}

function renderActivity(filteredTransactions: Transaction[]) {
  return `
    <section class="section stack">
      <div class="section-header">
        <div>
          <p class="muted-label">Moves</p>
          <h2>Expenses and paychecks</h2>
        </div>
      </div>

      <label class="search-box">
        ${renderIcon('search')}
        <input
          id="search-input"
          data-field="search"
          type="search"
          placeholder="Search merchant, note, or category"
          value="${escapeAttribute(state.search)}"
        />
      </label>

      <article class="section-card">
        <div class="section-header compact">
          <div>
            <p class="muted-label">Paychecks</p>
            <h3>Logged payouts</h3>
          </div>
        </div>
        <div class="plan-list">
          ${state.paychecks.length
            ? state.paychecks
                .map(
                  (paycheck) => `
                    <article class="plan-row">
                      <div class="plan-main">
                        <span class="plan-icon paycheck">${renderIcon('paycheck')}</span>
                        <div>
                          <strong>${formatCurrency(paycheck.amount)}</strong>
                          <p>${formatShortDate(paycheck.date)} · ${escapeHtml(paycheck.note || 'Paycheck entry')}</p>
                        </div>
                      </div>
                      <button class="ghost-button danger" data-action="delete-paycheck" data-paycheck-id="${paycheck.id}">Delete</button>
                    </article>
                  `,
                )
                .join('')
            : '<p class="muted-paragraph">No paychecks logged yet.</p>'}
        </div>
      </article>

      ${
        filteredTransactions.length
          ? renderTransactionList(filteredTransactions)
          : `
            <div class="empty-card">
              <img src="${heroImage}" alt="Abstract pattern" class="empty-image" />
              <div>
                <h3>No matches</h3>
                <p>Try a different search or log a new expense.</p>
              </div>
              <button class="primary-button" data-action="open-quick-add">Add expense</button>
            </div>
          `
      }
    </section>
  `
}

function renderInsights(cycle: CycleSummary, monthSummary: MonthSummary) {
  const breakdown = state.categories
    .map((category) => ({
      category,
      spent: cycleExpensesByCategory(cycle.start, cycle.end)[category.id] ?? 0,
    }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5)

  const spendTrackRatio =
    cycle.spendableAfterPlan && cycle.spendableAfterPlan > 0 && cycle.expensesLogged > 0
      ? Math.min(cycle.expensesLogged / cycle.spendableAfterPlan, 1.25)
      : 0

  return `
    <section class="section stack">
      <article class="premium-card insights-hero">
        <div class="section-header compact">
          <div>
            <p class="muted-label">Runway</p>
            ${
              cycle.actualPaycheck !== null
                ? `<h2>${formatCurrency(cycle.spendableLeft ?? 0)}</h2>`
                : `<button class="ghost-button runway-paycheck-button" data-action="open-paycheck-modal">Input net pay</button>`
            }
          </div>
          <div class="pill-stack">
            <span class="status-pill">${cycle.daysLeft} day${cycle.daysLeft === 1 ? '' : 's'} left</span>
            <span class="status-pill ${cycle.actualPaycheck !== null ? 'ok' : 'warn'}">${cycle.actualPaycheck !== null ? 'Live cutoff' : 'Needs net pay'}</span>
          </div>
        </div>
        <div class="button-row hero-actions">
          <button class="ghost-button" data-action="open-paycheck-modal">${cycle.actualPaycheck !== null ? 'Update net pay' : 'Input net pay'}</button>
          <button class="ghost-button" data-action="open-settings">Adjust cycle</button>
        </div>
        <div class="progress-track wide-track ${spendTrackRatio > 1 ? 'danger' : spendTrackRatio > 0.8 ? 'warn' : 'ok'}">
          <span style="width:${Math.min(spendTrackRatio * 100, 100)}%"></span>
        </div>
        <div class="insight-grid">
          <article class="premium-card compact-card">
            <p class="muted-label">Cycle expenses</p>
            <h3>${formatCurrency(cycle.expensesLogged)}</h3>
          </article>
          <article class="premium-card compact-card">
            <p class="muted-label">This month spent</p>
            <h3>${formatCurrency(monthSummary.totalSpent)}</h3>
          </article>
          <article class="premium-card compact-card">
            <p class="muted-label">Bills reserved</p>
            <h3>${formatCurrency(cycle.billsReserved)}</h3>
          </article>
          <article class="premium-card compact-card">
            <p class="muted-label">Target daily spend</p>
            <h3>${cycle.dailyAllowance !== null ? formatCurrency(cycle.dailyAllowance) : 'Input pay'}</h3>
          </article>
        </div>
      </article>

      <article class="section-card">
        <div class="section-header compact">
          <div>
            <p class="muted-label">Top categories</p>
            <h3>Where this cutoff is going</h3>
          </div>
        </div>
        <div class="bar-list">
          ${breakdown.length
            ? breakdown
                .map(({ category, spent }) => {
                  const width = cycle.expensesLogged ? (spent / cycle.expensesLogged) * 100 : 0
                  return `
                    <div class="bar-row">
                      <div class="bar-row-label">
                        <span>${escapeHtml(category.name)}</span>
                        <strong>${formatCurrency(spent)}</strong>
                      </div>
                      <div class="progress-track">
                        <span style="width:${width}%;background:${category.color};"></span>
                      </div>
                    </div>
                  `
                })
                .join('')
            : '<p class="muted-paragraph">No expense data yet for this cutoff.</p>'}
        </div>
      </article>
    </section>
  `
}

function renderSettings() {
  return `
    <section class="section stack">
      <article class="section-card form-stack">
        <div class="section-header">
          <div>
            <p class="muted-label">Settings</p>
            <h2>Cycle</h2>
          </div>
        </div>
        <div class="cycle-date-row">
          <label class="field ${state.editingLastCutoff ? '' : 'is-readonly'}">
            <span>Last cutoff date</span>
            <input
              id="settings-last-cutoff-date"
              data-field="last-cutoff-date"
              type="date"
              value="${state.settings.lastCutoffDate}"
              ${state.editingLastCutoff ? '' : 'readonly'}
            />
          </label>
          <button class="ghost-button cycle-edit-button" data-action="toggle-last-cutoff-edit">${state.editingLastCutoff ? 'Done' : 'Edit'}</button>
        </div>
        <label class="field">
          <span>Next cutoff date</span>
          <input id="settings-next-cutoff-date" data-field="next-cutoff-date" type="date" value="${state.settings.nextCutoffDate}" />
        </label>
        <p class="muted-paragraph">Adjust these dates whenever payroll shifts. The active cutoff runs from the last cutoff date to the next cutoff date.</p>
        <button class="primary-button" data-action="save-settings">Update cycle</button>
      </article>

      <article class="section-card form-stack">
        <div class="section-header">
          <div>
            <p class="muted-label">Appearance</p>
            <h3>Theme</h3>
          </div>
        </div>
        <div class="button-row">
          <button class="theme-button ${state.settings.theme === 'dark' ? 'is-active' : ''}" data-action="set-theme" data-theme="dark">Dark</button>
          <button class="theme-button ${state.settings.theme === 'light' ? 'is-active' : ''}" data-action="set-theme" data-theme="light">Light</button>
        </div>
        <div class="theme-palette-grid">
          ${renderAccentThemeButton('ocean', 'Ocean')}
          ${renderAccentThemeButton('emerald', 'Emerald')}
          ${renderAccentThemeButton('sunset', 'Sunset')}
          ${renderAccentThemeButton('rose', 'Rose')}
          ${renderAccentThemeButton('custom', 'Custom')}
        </div>
        ${
          state.settings.accentTheme === 'custom'
            ? `
              <label class="field">
                <span>Custom accent color</span>
                <div class="custom-accent-row">
                  <input id="settings-custom-accent" data-field="custom-accent" class="custom-accent-input" type="color" value="${escapeAttribute(state.settings.customAccent)}" />
                  <span class="custom-accent-value">${escapeHtml(state.settings.customAccent.toUpperCase())}</span>
                </div>
              </label>
            `
            : ''
        }
      </article>

      <article class="section-card form-stack">
        <div class="section-header">
          <div>
            <p class="muted-label">Cloud</p>
            <h3>Account and sync</h3>
          </div>
          ${cloudConfigured ? `<span class="status-pill ${state.syncStatus === 'error' ? 'warn' : 'ok'}">${escapeHtml(getSyncStatusLabel())}</span>` : ''}
        </div>
        ${renderCloudSettings()}
      </article>

      <article class="section-card form-stack">
        <div class="section-header">
          <div>
            <p class="muted-label">Data</p>
            <h3>Backup and restore</h3>
          </div>
        </div>
        <div class="button-row">
          <button class="primary-button" data-action="export-backup">Export backup</button>
          <button class="ghost-button" data-action="trigger-import">Restore backup</button>
        </div>
        <input id="import-backup-input" type="file" accept="application/json" hidden />
        ${
          state.settings.exportMetadata.lastExportAt
            ? `<p class="tiny-note">Last export: ${new Date(state.settings.exportMetadata.lastExportAt).toLocaleString()}</p>`
            : ''
        }
      </article>

    </section>
  `
}

function renderSyncBadge() {
  if (!cloudConfigured) {
    return `<span class="sync-badge muted">Local only</span>`
  }

  const label = getSyncStatusLabel()
  const tone =
    state.syncStatus === 'error'
      ? 'warn'
      : state.syncStatus === 'offline'
        ? 'muted'
        : state.user
          ? 'ok'
          : 'muted'

  return `<span class="sync-badge ${tone}">${escapeHtml(label)}</span>`
}

function renderCloudSettings() {
  if (!cloudConfigured) {
    return `
      <div class="cloud-panel">
        <p class="muted-paragraph">Cloud login is ready in the code, but it still needs your backend keys before it can go live.</p>
        <p class="tiny-note">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> locally and in GitHub Pages secrets.</p>
      </div>
    `
  }

  if (!state.authReady) {
    return `<p class="muted-paragraph">Checking your cloud session...</p>`
  }

  if (!state.user) {
    return `
      <div class="form-stack cloud-panel">
        <div class="type-switch">
          <button class="${state.authMode === 'sign_in' ? 'is-active' : ''}" data-action="set-auth-mode" data-auth-mode="sign_in">Sign in</button>
          <button class="${state.authMode === 'sign_up' ? 'is-active' : ''}" data-action="set-auth-mode" data-auth-mode="sign_up">Register</button>
        </div>

        ${
          state.authMode === 'sign_up'
            ? `
              <label class="field">
                <span>Display name</span>
                <input data-field="auth-display-name" value="${escapeAttribute(state.authDraft.displayName)}" placeholder="Josh, Mom, Kuya" />
              </label>
            `
            : ''
        }

        <label class="field">
          <span>Email</span>
          <input data-field="auth-email" type="email" value="${escapeAttribute(state.authDraft.email)}" placeholder="family@email.com" autocapitalize="off" />
        </label>
        <label class="field">
          <span>Password</span>
          <input data-field="auth-password" type="password" value="${escapeAttribute(state.authDraft.password)}" placeholder="At least 6 characters" />
        </label>
        ${state.authError ? `<p class="form-error">${escapeHtml(state.authError)}</p>` : `<p class="muted-paragraph">Once signed in, this device stays usable offline and syncs again when you reconnect.</p>`}
        <button class="primary-button" data-action="submit-auth" ${state.authBusy ? 'disabled' : ''}>${state.authBusy ? 'Working...' : state.authMode === 'sign_in' ? 'Sign in' : 'Create account'}</button>
      </div>
    `
  }

  return `
    <div class="form-stack cloud-panel">
      <div class="profile-card">
        <div>
          <p class="muted-label">Signed in as</p>
          <strong>${escapeHtml(state.user.displayName)}</strong>
          <p class="tiny-note">${escapeHtml(state.user.email)}</p>
        </div>
        <span class="status-pill ${state.syncStatus === 'error' ? 'warn' : 'ok'}">${escapeHtml(getSyncStatusLabel())}</span>
      </div>
      <label class="field">
        <span>Profile name</span>
        <input data-field="auth-display-name" value="${escapeAttribute(state.authDraft.displayName)}" placeholder="Family member name" />
      </label>
      <p class="muted-paragraph">${escapeHtml(state.syncMessage)}</p>
      <div class="button-row">
        <button class="primary-button" data-action="update-profile">Save profile</button>
        <button class="ghost-button" data-action="sync-cloud-now">Sync now</button>
      </div>
      <button class="ghost-button danger subtle-danger" data-action="sign-out">Log out</button>
    </div>
  `
}

function getSyncStatusLabel() {
  switch (state.syncStatus) {
    case 'syncing':
      return 'Syncing'
    case 'synced':
      return 'Synced'
    case 'offline':
      return 'Offline'
    case 'error':
      return 'Needs attention'
    case 'local':
      return 'Local only'
    default:
      return state.user ? 'Connected' : 'Not connected'
  }
}

function renderQuickAdd(cycle: CycleSummary) {
  return `
    <div class="sheet-backdrop" data-action="close-quick-add"></div>
    <section class="sheet" aria-label="${state.editingTransactionId ? 'Edit expense' : 'Quick add expense'}">
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <p class="muted-label">${state.editingTransactionId ? 'Adjust the spend' : 'Log an expense fast'}</p>
          <h2>${state.editingTransactionId ? 'Edit expense' : 'Quick add'}</h2>
        </div>
        <button class="icon-button" data-action="close-quick-add" aria-label="Close">${renderIcon('close')}</button>
      </div>

      <div class="type-switch">
        <button class="${state.quickType === 'expense' ? 'is-active' : ''}" data-action="set-quick-type" data-type="expense">Expense</button>
        <button class="${state.quickType === 'income' ? 'is-active' : ''}" data-action="set-quick-type" data-type="income">Other income</button>
      </div>

      <div class="amount-display">
        <span>${state.quickType === 'expense' ? '-' : '+'}</span>
        <strong>${formatCurrencyDisplay(parseFloat(state.amountInput || '0'))}</strong>
      </div>

      <div class="chip-wrap">
        ${state.categories
          .map(
            (category) => `
              <button
                class="chip ${state.quickCategoryId === category.id ? 'is-selected' : ''}"
                data-action="set-quick-category"
                data-category-id="${category.id}"
              >
                <span class="chip-icon">${renderIcon(category.icon)}</span>
                ${escapeHtml(category.name)}
              </button>
            `,
          )
          .join('')}
      </div>

      <button class="detail-toggle" data-action="toggle-details">
        ${state.quickAddExpanded ? 'Hide details' : 'Add merchant, note, or date'}
      </button>

      ${
        state.quickAddExpanded
          ? `
            <div class="detail-grid">
              <label class="field">
                <span>Merchant</span>
                <input id="quick-merchant" data-field="quick-merchant" value="${escapeAttribute(state.quickMerchant)}" placeholder="Coffee, groceries, ride" />
              </label>
              <label class="field">
                <span>Date</span>
                <input id="quick-date" data-field="quick-date" type="date" value="${state.quickDate}" />
              </label>
              <label class="field">
                <span>Note</span>
                <textarea id="quick-note" data-field="quick-note" rows="2" placeholder="Optional note">${escapeHtml(state.quickNote)}</textarea>
              </label>
            </div>
          `
          : `
            <div class="helper-row">
              <span>Safe daily pace until ${escapeHtml(cycle.nextPaydayLabel)}</span>
              <strong>${cycle.dailyAllowance !== null ? formatCurrency(cycle.dailyAllowance) : 'Pending paycheck'}</strong>
            </div>
          `
      }

      <div class="keypad">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map(renderKeypadButton).join('')}
      </div>

      <div class="button-row sticky-actions">
        <button class="ghost-button" data-action="close-quick-add">Cancel</button>
        <button class="primary-button" data-action="save-transaction" ${canSaveQuickAdd() ? '' : 'disabled'}>
          ${state.editingTransactionId ? 'Save changes' : 'Save'}
        </button>
      </div>
    </section>
  `
}

function renderBillComposer() {
  return `
    <div class="sheet-backdrop" data-action="close-bill-modal"></div>
    <section class="sheet" aria-label="Add bill">
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <p class="muted-label">Bills</p>
          <h2>Add bill</h2>
        </div>
        <button class="icon-button" data-action="close-bill-modal" aria-label="Close">${renderIcon('close')}</button>
      </div>

      <div class="form-stack">
        <label class="field">
          <span>Bill name</span>
          <input id="bill-name" data-field="bill-name" value="${escapeAttribute(state.billDraft.name)}" placeholder="Maya, rent, internet, loan" />
        </label>

        <div class="dual-grid">
          <label class="field">
            <span>Amount</span>
            <input id="bill-amount" data-field="bill-amount" inputmode="decimal" value="${escapeAttribute(state.billDraft.amount)}" placeholder="2500" />
          </label>
          <label class="field">
            <span>Due day</span>
            <input id="bill-due-day" data-field="bill-due-day" type="number" min="1" max="31" value="${escapeAttribute(state.billDraft.dueDay)}" placeholder="14" />
          </label>
        </div>

        <div class="dual-grid">
          <label class="field">
            <span>Starts on</span>
            <input id="bill-start-date" data-field="bill-start-date" type="date" value="${state.billDraft.startDate}" />
          </label>
        </div>

        <div class="form-stack bill-term-picker">
          <div>
            <p class="muted-label">Payment type</p>
          </div>
          <div class="type-switch">
            <button class="${state.billDraft.recurrenceType === 'one_time' ? 'is-active' : ''}" data-action="set-bill-recurrence-type" data-recurrence-type="one_time">One time</button>
            <button class="${state.billDraft.recurrenceType === 'recurring' ? 'is-active' : ''}" data-action="set-bill-recurrence-type" data-recurrence-type="recurring">Recurring</button>
          </div>

          ${
            state.billDraft.recurrenceType === 'recurring'
              ? `
                <div class="type-switch">
                  <button class="${state.billDraft.recurrenceMode === 'indefinite' ? 'is-active' : ''}" data-action="set-bill-recurrence-mode" data-recurrence-mode="indefinite">Indefinitely</button>
                  <button class="${state.billDraft.recurrenceMode === 'custom' ? 'is-active' : ''}" data-action="set-bill-recurrence-mode" data-recurrence-mode="custom">Custom</button>
                </div>
                ${
                  state.billDraft.recurrenceMode === 'custom'
                    ? `
                      <label class="field">
                        <span>Number of payments</span>
                        <input
                          id="bill-custom-occurrences"
                          data-field="bill-custom-occurrences"
                          type="number"
                          min="1"
                          step="1"
                          value="${escapeAttribute(state.billDraft.customOccurrences)}"
                          placeholder="12"
                        />
                      </label>
                    `
                    : ''
                }
              `
              : ''
          }
        </div>

        <button class="field split-toggle ${state.billDraft.splitAcrossCutoffs ? 'is-active' : ''}" data-action="toggle-bill-split" type="button">
          <span>Split across 2 cutoffs</span>
          <strong>${state.billDraft.splitAcrossCutoffs ? 'On' : 'Off'}</strong>
        </button>

        ${
          state.billDraft.splitAcrossCutoffs
            ? `
              <label class="field">
                <span>Second cutoff date</span>
                <input
                  id="bill-split-second-date"
                  data-field="bill-split-second-date"
                  type="date"
                  value="${state.billDraft.splitSecondDate || state.billDraft.startDate}"
                />
              </label>
            `
            : ''
        }

        <div class="button-row">
          <button class="ghost-button" data-action="close-bill-modal">Cancel</button>
          <button class="primary-button" data-action="add-bill">Save bill</button>
        </div>
      </div>
    </section>
  `
}

function renderPaycheckComposer() {
  return `
    <div class="sheet-backdrop" data-action="close-paycheck-modal"></div>
    <section class="sheet" aria-label="Log net pay">
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <p class="muted-label">Runway</p>
          <h2>Input net pay</h2>
        </div>
        <button class="icon-button" data-action="close-paycheck-modal" aria-label="Close">${renderIcon('close')}</button>
      </div>

      <div class="form-stack">
        <label class="field">
          <span>Net pay received</span>
          <input id="paycheck-amount" data-field="paycheck-amount" inputmode="decimal" value="${escapeAttribute(state.paycheckDraft.amount)}" placeholder="18500" />
        </label>
        <label class="field">
          <span>Pay date</span>
          <input id="paycheck-date" data-field="paycheck-date" type="date" value="${state.paycheckDraft.date}" />
        </label>
        <label class="field">
          <span>Note</span>
          <input id="paycheck-note" data-field="paycheck-note" value="${escapeAttribute(state.paycheckDraft.note)}" placeholder="Regular salary, partial payout, bonus" />
        </label>
        <div class="button-row">
          <button class="ghost-button" data-action="close-paycheck-modal">Cancel</button>
          <button class="primary-button" data-action="log-paycheck">Save net pay</button>
        </div>
      </div>
    </section>
  `
}

function renderAccentThemeButton(theme: Settings['accentTheme'], label: string) {
  return `
    <button class="accent-theme-button ${state.settings.accentTheme === theme ? 'is-active' : ''}" data-action="set-accent-theme" data-accent-theme="${theme}">
      <span class="accent-preview ${theme === 'custom' ? '' : `accent-preview-${theme}`}" ${theme === 'custom' ? `style="background:${escapeAttribute(state.settings.customAccent)}"` : ''}></span>
      <span>${label}</span>
    </button>
  `
}

function renderNavButton(view: View, label: string) {
  return `
    <button class="nav-button ${state.view === view ? 'is-active' : ''}" data-action="switch-view" data-view="${view}">
      ${renderIcon(view)}
      <span>${label}</span>
    </button>
  `
}

function renderTransactionList(transactions: Transaction[]) {
  return `
    <div class="transaction-list">
      ${transactions
        .map((transaction) => {
          const category = state.categories.find((item) => item.id === transaction.categoryId)
          return `
            <article class="transaction-row">
              <div class="transaction-main">
                <span class="mini-icon" style="background:${category?.color ?? '#66e2c0'}1f;color:${category?.color ?? '#66e2c0'};">
                  ${renderIcon(category?.icon ?? 'category')}
                </span>
                <div>
                  <strong>${escapeHtml(transaction.merchant || category?.name || 'Transaction')}</strong>
                  <p>${escapeHtml(category?.name ?? 'Uncategorized')} · ${formatShortDate(transaction.date)}${transaction.note ? ` · ${escapeHtml(transaction.note)}` : ''}</p>
                </div>
              </div>
              <div class="transaction-side">
                <strong class="${transaction.type === 'income' ? 'is-positive' : ''}">
                  ${transaction.type === 'income' ? '+' : '-'}${formatCurrency(transaction.amount)}
                </strong>
                <div class="transaction-actions">
                  <button class="ghost-button" data-action="edit-transaction" data-transaction-id="${transaction.id}">Edit</button>
                  <button class="ghost-button danger" data-action="delete-transaction" data-transaction-id="${transaction.id}">Delete</button>
                </div>
              </div>
            </article>
          `
        })
        .join('')}
    </div>
  `
}

function renderEmptyState() {
  return `
    <div class="empty-card">
      <img src="${heroImage}" alt="Abstract pattern" class="empty-image" />
      <div>
        <h3>No expenses logged yet</h3>
        <p>Add one spend and the runway will start updating in real time.</p>
      </div>
      <button class="primary-button" data-action="open-quick-add">Add expense</button>
    </div>
  `
}

function renderKeypadButton(key: string) {
  return `
    <button class="keypad-button" data-action="key" data-value="${key}">
      ${key === 'back' ? '⌫' : key}
    </button>
  `
}

function renderIcon(name: string) {
  switch (name) {
    case 'home':
      return svg('<path d="M3 11 12 4l9 7"/><path d="M5 10v9h14v-9"/>')
    case 'bills':
      return svg('<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 9h8"/><path d="M8 13h6"/><path d="M8 17h4"/>')
    case 'planner':
      return svg('<path d="M7 3v4"/><path d="M17 3v4"/><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 11h8"/><path d="M8 15h5"/>')
    case 'activity':
      return svg('<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h9"/>')
    case 'insights':
      return svg('<path d="M5 18V9"/><path d="M12 18V5"/><path d="M19 18v-7"/>')
    case 'settings':
      return svg('<path d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z"/><path d="M4 12h2"/><path d="M18 12h2"/><path d="m6.3 6.3 1.4 1.4"/><path d="m16.3 16.3 1.4 1.4"/><path d="m16.3 7.7 1.4-1.4"/><path d="m6.3 17.7 1.4-1.4"/>')
    case 'plus':
      return svg('<path d="M12 5v14"/><path d="M5 12h14"/>')
    case 'gear':
      return svg('<path d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z"/><path d="M4 12h2"/><path d="M18 12h2"/><path d="m6.3 6.3 1.4 1.4"/><path d="m16.3 16.3 1.4 1.4"/><path d="m16.3 7.7 1.4-1.4"/><path d="m6.3 17.7 1.4-1.4"/>')
    case 'close':
      return svg('<path d="m6 6 12 12"/><path d="m18 6-12 12"/>')
    case 'search':
      return svg('<circle cx="11" cy="11" r="6"/><path d="m17 17 3 3"/>')
    case 'bill':
      return svg('<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M8 9h8"/><path d="M8 13h6"/><path d="M8 17h4"/>')
    case 'paycheck':
      return svg('<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h4"/><path d="M14 12h3"/>')
    case 'utensils':
      return svg('<path d="M7 4v7"/><path d="M10 4v7"/><path d="M7 8h3"/><path d="M17 4c-1.7 0-3 1.3-3 3v13"/><path d="M7 11v9"/>')
    case 'route':
      return svg('<circle cx="7" cy="17" r="2"/><circle cx="17" cy="7" r="2"/><path d="M9 17h4a4 4 0 0 0 4-4V9"/>')
    case 'home':
      return svg('<path d="M3 11 12 4l9 7"/><path d="M5 10v9h14v-9"/>')
    case 'bag':
      return svg('<path d="M6 8h12l-1 11H7L6 8Z"/><path d="M9 8a3 3 0 0 1 6 0"/>')
    case 'heart':
      return svg('<path d="m12 20-7-7a4.5 4.5 0 0 1 6.4-6.3L12 7.9l.6-.6A4.5 4.5 0 0 1 19 13l-7 7Z"/>')
    case 'spark':
      return svg('<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>')
    case 'bolt':
      return svg('<path d="M13 2 6 13h5l-1 9 7-11h-5l1-9Z"/>')
    default:
      return `<span class="fallback-icon">${escapeHtml(name.charAt(0).toUpperCase())}</span>`
  }
}

function svg(path: string) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
}

function getBillPreview(bill: RecurringBill) {
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  for (let offset = 0; offset < 24; offset += 1) {
    const candidate = new Date(today.getFullYear(), today.getMonth() + offset, clampDueDay(bill.dueDay, today.getFullYear(), today.getMonth() + offset))
    if (candidate < new Date(bill.startDate)) continue
    if (candidate < startOfToday) continue

    const occurrenceNumber = getOccurrenceNumber(bill, candidate)
    if (occurrenceNumber === null) continue

    const dayDiff = diffInDays(today, candidate)
    return {
      dueDate: candidate,
      occurrenceNumber,
      status: dayDiff <= 7 ? 'Due soon' : 'On track',
      label: formatLongDate(toLocalIso(candidate)),
    }
  }

  return {
    dueDate: null,
    occurrenceNumber: null,
    status: 'Completed',
    label: 'term completed',
  }
}

function getCurrentCycleSummary(): CycleSummary {
  const cycleWindow = getCycleWindow()
  const dueBills = getBillsForCycle(cycleWindow.startDate, cycleWindow.endDate)
  const billReserved = dueBills.reduce((sum, bill) => sum + bill.reservedAmount, 0)
  const paycheck = getCyclePaycheck(cycleWindow.start, cycleWindow.end)
  const actualPaycheck = paycheck?.amount ?? null
  const availableIncome = actualPaycheck
  const cycleExpenses = state.transactions
    .filter((item) => item.type === 'expense' && item.date >= cycleWindow.start && item.date < cycleWindow.end)
    .reduce((sum, item) => sum + item.amount, 0)
  const spendableAfterPlan = availableIncome !== null ? Math.max(0, availableIncome - billReserved) : null
  const spendableLeft = spendableAfterPlan !== null ? spendableAfterPlan - cycleExpenses : null
  const daysLeft = Math.max(1, diffInDays(new Date(), cycleWindow.endDate))
  const autoDaily = spendableLeft !== null ? spendableLeft / daysLeft : null

  return {
    start: cycleWindow.start,
    end: cycleWindow.end,
    label: cycleWindow.label,
    actualPaycheck,
    availableIncome,
    billsReserved: billReserved,
    expensesLogged: cycleExpenses,
    spendableAfterPlan,
    spendableLeft,
    dailyAllowance: autoDaily,
    nextPaydayLabel: cycleWindow.nextPaydayLabel,
    daysLeft,
    dueBills,
  }
}

function getCurrentMonthSummary(): MonthSummary {
  const monthStart = new Date()
  monthStart.setDate(1)
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
  const start = toLocalIso(monthStart)
  const end = toLocalIso(monthEnd)
  const transactions = state.transactions.filter((item) => item.date >= start && item.date < end)
  const totalSpent = transactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0)
  const totalIncome = transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0)
  const totalBudget = state.categories.reduce((sum, category) => sum + category.monthlyBudget, 0)
  const categoryTotals = Object.fromEntries(state.categories.map((category) => [category.id, 0])) as Record<string, number>
  transactions.forEach((transaction) => {
    if (transaction.type === 'expense') {
      categoryTotals[transaction.categoryId] = (categoryTotals[transaction.categoryId] ?? 0) + transaction.amount
    }
  })

  return {
    monthKey: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`,
    label: monthStart.toLocaleDateString(state.settings.locale || undefined, { month: 'long', year: 'numeric' }),
    totalSpent,
    totalIncome,
    totalBudget,
    remaining: totalBudget - totalSpent,
    categoryTotals,
  }
}

function getFilteredTransactions() {
  const query = state.search.trim().toLowerCase()
  if (!query) return state.transactions.filter((item) => item.type === 'expense')

  return state.transactions.filter((transaction) => {
    const category = state.categories.find((item) => item.id === transaction.categoryId)
    return [transaction.merchant, transaction.note, category?.name].join(' ').toLowerCase().includes(query)
  })
}

function cycleExpensesByCategory(start: string, end: string) {
  const totals = Object.fromEntries(state.categories.map((category) => [category.id, 0])) as Record<string, number>
  state.transactions
    .filter((item) => item.type === 'expense' && item.date >= start && item.date < end)
    .forEach((transaction) => {
      totals[transaction.categoryId] = (totals[transaction.categoryId] ?? 0) + transaction.amount
    })
  return totals
}

function getCyclePaycheck(cycleStart: string, cycleEnd: string) {
  return (
    state.paychecks
      .filter((paycheck) => paycheck.date >= cycleStart && paycheck.date < cycleEnd)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

function getBillsForCycle(startDate: Date, endDate: Date) {
  const bills: Array<RecurringBill & { dueDate: string; reservedAmount: number; occurrenceNumber: number | null }> = []
  for (const bill of state.bills) {
    const currentDue = getDueBillForCycle(bill, startDate, endDate)
    if (currentDue) {
      bills.push(currentDue)
    }
  }
  return bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name))
}

function getDueBillForCycle(
  bill: RecurringBill,
  startDate: Date,
  endDate: Date,
): (RecurringBill & { dueDate: string; reservedAmount: number; occurrenceNumber: number | null }) | null {
  const currentDueDate = getDueDateInRange(startDate, endDate, bill.dueDay)
  if (currentDueDate) {
    const occurrenceNumber = getOccurrenceNumber(bill, currentDueDate)
    if (occurrenceNumber === null) return null
    return {
      ...bill,
      dueDate: toLocalIso(currentDueDate),
      reservedAmount: bill.splitAcrossCutoffs ? bill.amount / 2 : bill.amount,
      occurrenceNumber,
    }
  }

  if (!bill.splitAcrossCutoffs) return null

  const nextCycleDueDate = getDueDateInRange(endDate, getNextCycleEnd(startDate, endDate), bill.dueDay)
  if (!nextCycleDueDate) return null

  const occurrenceNumber = getOccurrenceNumber(bill, nextCycleDueDate)
  if (occurrenceNumber === null) return null

  return {
    ...bill,
    dueDate: toLocalIso(nextCycleDueDate),
    reservedAmount: bill.amount / 2,
    occurrenceNumber,
  }
}

function getDueDateInRange(startDate: Date, endDate: Date, dueDay: number) {
  const candidates = [
    new Date(startDate.getFullYear(), startDate.getMonth(), clampDueDay(dueDay, startDate.getFullYear(), startDate.getMonth())),
    new Date(endDate.getFullYear(), endDate.getMonth(), clampDueDay(dueDay, endDate.getFullYear(), endDate.getMonth())),
  ]

  return candidates.find((date) => date >= startDate && date < endDate) ?? null
}

function getOccurrenceNumber(bill: RecurringBill, dueDate: Date) {
  const startDate = new Date(bill.startDate)
  const dueMonthIndex = dueDate.getFullYear() * 12 + dueDate.getMonth()
  const startMonthIndex = startDate.getFullYear() * 12 + startDate.getMonth()
  const diff = dueMonthIndex - startMonthIndex
  if (diff < 0) return null
  const occurrenceNumber = diff + 1
  if (bill.totalOccurrences !== null && occurrenceNumber > bill.totalOccurrences) return null
  return occurrenceNumber
}

function getNextCycleEnd(cycleStartDate: Date, cycleEndDate: Date) {
  const cycleLength = Math.max(1, diffInDays(cycleStartDate, cycleEndDate))
  return new Date(cycleEndDate.getFullYear(), cycleEndDate.getMonth(), cycleEndDate.getDate() + cycleLength)
}

function getCycleWindow() {
  const endDate = parseLocalDate(state.settings.nextCutoffDate || defaultNextCutoffDate())
  let startDate = parseLocalDate(state.settings.lastCutoffDate || defaultLastCutoffDate(toLocalIso(endDate)))
  if (startDate >= endDate) {
    startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - 14)
  }

  return {
    startDate,
    endDate,
    start: toLocalIso(startDate),
    end: toLocalIso(endDate),
    label: `${formatShortDate(toLocalIso(startDate))} - ${formatShortDate(toLocalIso(new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - 1)))}`,
    nextPaydayLabel: formatShortDate(toLocalIso(endDate)),
  }
}

function openQuickAdd() {
  state.quickAddOpen = true
  state.quickAddExpanded = false
  if (!state.quickCategoryId && state.categories.length) {
    state.quickCategoryId = state.categories[0].id
  }
  if (!state.editingTransactionId) {
    state.amountInput = ''
    state.quickMerchant = ''
    state.quickNote = ''
    state.quickDate = todayIso()
    state.quickType = 'expense'
  }
}

function closeQuickAdd() {
  state.quickAddOpen = false
  state.quickAddExpanded = false
  state.editingTransactionId = null
  state.amountInput = ''
  state.quickMerchant = ''
  state.quickNote = ''
  state.quickDate = todayIso()
  state.quickType = 'expense'
}

function updateAmountInput(value: string) {
  if (value === 'back') {
    state.amountInput = state.amountInput.slice(0, -1)
    return
  }
  if (value === '.' && state.amountInput.includes('.')) return
  if (value === '.' && !state.amountInput) {
    state.amountInput = '0.'
    return
  }
  if (state.amountInput === '0' && value !== '.') {
    state.amountInput = value
    return
  }
  state.amountInput += value
}

async function commitQuickAdd() {
  const editingId = state.editingTransactionId
  if (!canSaveQuickAdd()) return

  const amount = parseFloat(state.amountInput)
  const now = new Date().toISOString()
  const existing = editingId ? state.transactions.find((item) => item.id === editingId) : null
  const transaction: Transaction = {
    id: editingId || createId(),
    amount,
    type: state.quickType,
    categoryId: state.quickCategoryId,
    merchant: state.quickMerchant.trim(),
    note: state.quickNote.trim(),
    date: state.quickDate,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }

  await saveTransaction(transaction)
  await refreshData()
  queueCloudSync()
  closeQuickAdd()
  flashToast(editingId ? 'Transaction updated.' : 'Expense saved.')
  render()
}

function startEditing(id: string) {
  const transaction = state.transactions.find((item) => item.id === id)
  if (!transaction) return
  state.editingTransactionId = id
  state.quickAddOpen = true
  state.quickAddExpanded = true
  state.amountInput = transaction.amount.toString()
  state.quickType = transaction.type
  state.quickCategoryId = transaction.categoryId
  state.quickMerchant = transaction.merchant
  state.quickNote = transaction.note
  state.quickDate = transaction.date
}

async function removeTransaction(id: string) {
  if (!window.confirm('Delete this transaction?')) return
  await deleteTransaction(id)
  await refreshData()
  queueCloudSync()
  flashToast('Transaction deleted.')
  render()
}

async function persistSettings() {
  state.settings.lastCutoffDate = normalizeCutoffDate(state.settings.lastCutoffDate, -14)
  state.settings.nextCutoffDate = normalizeCutoffDate(state.settings.nextCutoffDate)
  if (parseLocalDate(state.settings.lastCutoffDate) >= parseLocalDate(state.settings.nextCutoffDate)) {
    state.settings.lastCutoffDate = defaultLastCutoffDate(state.settings.nextCutoffDate)
  }
  await saveSettings(state.settings)
  applyTheme()
  await refreshData()
  queueCloudSync()
  state.editingLastCutoff = false
  flashToast('Cycle updated.')
  render()
}

function updateCategoryDraft(categoryId: string, monthlyBudget: number) {
  state.categories = state.categories.map((category) =>
    category.id === categoryId
      ? { ...category, monthlyBudget: Number.isFinite(monthlyBudget) ? Math.max(0, monthlyBudget) : 0 }
      : category,
  )
}

async function persistCategories() {
  await saveCategories(state.categories)
  await refreshData()
  queueCloudSync()
  flashToast('Category budgets saved.')
  render()
}

async function addBill() {
  try {
    const trimmedName = state.billDraft.name.trim()
    const originalAmount = normalizeMoney(state.billDraft.amount)
    const parsedDueDay = Number(state.billDraft.dueDay)
    const dueDay = Number.isFinite(parsedDueDay) ? Math.max(1, Math.min(31, Math.round(parsedDueDay))) : NaN
    const secondSplitDate = state.billDraft.splitAcrossCutoffs ? state.billDraft.splitSecondDate || state.billDraft.startDate : ''

    if (!trimmedName) {
      flashToast('Add a bill name.')
      render()
      return
    }

    if (originalAmount <= 0) {
      flashToast('Add a valid amount.')
      render()
      return
    }

    if (!Number.isFinite(dueDay)) {
      flashToast('Add the main due day.')
      render()
      return
    }

    if (state.billDraft.splitAcrossCutoffs && !secondSplitDate) {
      flashToast('Pick the second cutoff date.')
      render()
      return
    }

    const totalOccurrences =
      state.billDraft.recurrenceType === 'one_time'
        ? 1
        : state.billDraft.recurrenceMode === 'indefinite'
          ? null
          : Math.max(1, Math.round(Number(state.billDraft.customOccurrences || '1')))

    const baseStartDate = state.billDraft.startDate || todayIso()
    const isSplitBill = state.billDraft.splitAcrossCutoffs
    const splitAmount = originalAmount / 2

    const billsToCreate: RecurringBill[] = isSplitBill
      ? [
          {
            id: createId(),
            name: `${trimmedName} 1`,
            amount: splitAmount,
            dueDay,
            startDate: baseStartDate,
            payTiming: 'due_date',
            splitAcrossCutoffs: false,
            totalOccurrences,
            active: true,
          },
          {
            id: createId(),
            name: `${trimmedName} 2`,
            amount: splitAmount,
            dueDay: parseLocalDate(secondSplitDate).getDate(),
            startDate: secondSplitDate,
            payTiming: 'due_date',
            splitAcrossCutoffs: false,
            totalOccurrences,
            active: true,
          },
        ]
      : [
          {
            id: createId(),
            name: trimmedName,
            amount: originalAmount,
            dueDay,
            startDate: baseStartDate,
            payTiming: 'due_date',
            splitAcrossCutoffs: false,
            totalOccurrences,
            active: true,
          },
        ]

    for (const bill of billsToCreate) {
      await saveBill(bill)
    }
    state.billDraft = {
      name: '',
      amount: '',
      dueDay: '',
      startDate: todayIso(),
      splitAcrossCutoffs: false,
      splitSecondDate: '',
      totalOccurrences: null,
      recurrenceType: 'recurring',
      recurrenceMode: 'indefinite',
      customOccurrences: '',
    }
    state.billModalOpen = false
    state.expandedBillId = billsToCreate[0].id
    await refreshData()
    queueCloudSync()
    flashToast(isSplitBill ? 'Split bill added.' : 'Bill added.')
    render()
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'Could not save bill. Please try again.'
    flashToast(message.length > 72 ? `${message.slice(0, 69)}...` : message)
    render()
  }
}

async function removeBill(id: string) {
  if (!window.confirm('Delete this recurring bill?')) return
  await deleteBill(id)
  await refreshData()
  queueCloudSync()
  flashToast('Recurring bill removed.')
  render()
}

async function logPaycheck() {
  const amount = normalizeMoney(state.paycheckDraft.amount)
  if (amount <= 0) {
    flashToast('Enter the actual paycheck amount.')
    render()
    return
  }

  const payDate = new Date(state.paycheckDraft.date || todayIso())
  const cycle = getCycleWindow()
  const existing = getCyclePaycheck(toLocalIso(payDate), cycle.end)
  if (existing) {
    await deletePaycheck(existing.id)
  }

  const paycheck: Paycheck = {
    id: createId(),
    amount,
    date: state.paycheckDraft.date || todayIso(),
    cycleStart: toLocalIso(payDate),
    cycleEnd: cycle.end,
    note: state.paycheckDraft.note.trim(),
    createdAt: new Date().toISOString(),
  }

  await savePaycheck(paycheck)
  state.paycheckDraft = { amount: '', date: todayIso(), note: '' }
  state.paycheckModalOpen = false
  await refreshData()
  queueCloudSync()
  flashToast('Paycheck logged.')
  render()
}

async function removePaycheck(id: string) {
  if (!window.confirm('Delete this paycheck entry?')) return
  await deletePaycheck(id)
  await refreshData()
  queueCloudSync()
  flashToast('Paycheck removed.')
  render()
}

async function exportBackup() {
  const payload: BackupData = buildBackupPayload(false)
  payload.settings.exportMetadata.lastExportAt = payload.exportedAt

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `cutoff-budget-backup-${todayIso()}.json`
  link.click()
  URL.revokeObjectURL(url)

  state.settings = payload.settings
  await saveSettings(state.settings)
  flashToast('Backup exported.')
  render()
}

async function importBackupFile(file: File) {
  try {
    const text = await file.text()
    const data = JSON.parse(text) as BackupData
    if (!Array.isArray(data.transactions) || !Array.isArray(data.categories) || !Array.isArray(data.bills) || !Array.isArray(data.paychecks)) {
      throw new Error('Invalid backup file')
    }
    if (!window.confirm('Restore this backup and replace the current local data?')) return
    await importBackup(data)
    await refreshData()
    applyTheme()
    queueCloudSync()
    flashToast('Backup restored.')
    render()
  } catch {
    flashToast('That backup could not be restored.')
    render()
  }
}

async function promptInstall() {
  if (!state.installPrompt) return
  await state.installPrompt.prompt()
  await state.installPrompt.userChoice
  state.installPrompt = null
  render()
}

async function submitAuth() {
  if (!cloudConfigured) {
    flashToast('Cloud sync is not configured yet.')
    return
  }

  const email = state.authDraft.email.trim()
  const password = state.authDraft.password
  const displayName = state.authDraft.displayName.trim()

  if (!email || !password) {
    state.authError = 'Add your email and password first.'
    render()
    return
  }

  if (state.authMode === 'sign_up' && !displayName) {
    state.authError = 'Add a display name for the family profile.'
    render()
    return
  }

  state.authBusy = true
  state.authError = ''
  render()

  try {
    const profile =
      state.authMode === 'sign_up'
        ? await signUpWithEmail(email, password, displayName)
        : await signInWithEmail(email, password)

    state.user = profile
    state.authDraft.displayName = profile?.displayName || displayName
    state.authDraft.email = profile?.email || email
    state.authDraft.password = ''
    await hydrateFromCloudIfNeeded()
    flashToast(state.authMode === 'sign_up' ? 'Account created.' : 'Signed in.')
  } catch (error) {
    state.authError = error instanceof Error ? error.message : 'Could not sign in right now.'
  } finally {
    state.authBusy = false
    render()
  }
}

async function signOutUser() {
  try {
    await signOutCloud()
    state.user = null
    state.authDraft.password = ''
    state.syncStatus = 'idle'
    state.syncMessage = 'Cloud sync not connected yet.'
    flashToast('Logged out.')
  } catch (error) {
    flashToast(error instanceof Error ? error.message : 'Could not log out.')
  }
  render()
}

async function saveProfile() {
  if (!state.user) return
  try {
    const profile = await updateCloudProfile(state.authDraft.displayName)
    state.user = profile
    state.authDraft.displayName = profile.displayName
    flashToast('Profile updated.')
  } catch (error) {
    flashToast(error instanceof Error ? error.message : 'Could not update profile.')
  }
  render()
}

async function syncCloudNow() {
  if (!state.user) {
    flashToast('Sign in first to sync.')
    return
  }
  await pushSnapshotToCloud()
  render()
}

async function hydrateFromCloudIfNeeded() {
  if (!state.user || !cloudConfigured) return

  try {
    state.syncStatus = navigator.onLine ? 'syncing' : 'offline'
    state.syncMessage = navigator.onLine ? 'Checking cloud data...' : 'Offline. Local data stays on this device for now.'
    render()

    if (!navigator.onLine) return

    const remote = await loadCloudSnapshot()
    const local = buildBackupPayload(false)
    if (remote) {
      const remoteTime = new Date(remote.exportedAt).getTime()
      const localTime = new Date(local.exportedAt).getTime()
      if (!hasMeaningfulLocalData() || remoteTime >= localTime) {
        await importBackup(remote)
        await refreshData()
        applyTheme()
      } else {
        await saveCloudSnapshot(local)
      }
      state.settings.exportMetadata.lastCloudSyncAt = new Date().toISOString()
      state.syncStatus = 'synced'
      state.syncMessage = 'Cloud backup is connected.'
      render()
      return
    }

    if (hasMeaningfulLocalData()) {
      await saveCloudSnapshot(local)
      state.settings.exportMetadata.lastCloudSyncAt = new Date().toISOString()
      state.syncStatus = 'synced'
      state.syncMessage = 'Local data copied to the cloud.'
    } else {
      state.syncStatus = 'synced'
      state.syncMessage = 'Cloud account is ready.'
    }
  } catch (error) {
    state.syncStatus = 'error'
    state.syncMessage = error instanceof Error ? error.message : 'Cloud sync hit a problem.'
  }
}

function queueCloudSync() {
  if (!state.user || !cloudConfigured) return
  if (!navigator.onLine) {
    state.syncStatus = 'offline'
    state.syncMessage = 'Offline. Changes are still safe on this device.'
    render()
    return
  }

  if (cloudSyncTimer !== null) {
    window.clearTimeout(cloudSyncTimer)
  }

  state.syncStatus = 'syncing'
  state.syncMessage = 'Saving to the cloud...'
  render()
  cloudSyncTimer = window.setTimeout(() => {
    void pushSnapshotToCloud()
  }, 500)
}

async function pushSnapshotToCloud() {
  if (!state.user || !cloudConfigured) return
  if (!navigator.onLine) {
    state.syncStatus = 'offline'
    state.syncMessage = 'Offline. Changes will sync later.'
    return
  }

  try {
    const payload = buildBackupPayload()
    await saveCloudSnapshot(payload)
    state.syncStatus = 'synced'
    state.syncMessage = `Synced ${new Date(payload.exportedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
  } catch (error) {
    state.syncStatus = 'error'
    state.syncMessage = error instanceof Error ? error.message : 'Cloud sync failed.'
  }
  render()
}

function buildBackupPayload(updateCloudTimestamp = true): BackupData {
  const now = new Date().toISOString()
  return {
    version: 1,
    exportedAt: now,
    settings: {
      ...state.settings,
      exportMetadata: {
        ...state.settings.exportMetadata,
        lastCloudSyncAt: updateCloudTimestamp ? now : state.settings.exportMetadata.lastCloudSyncAt,
      },
    },
    categories: state.categories,
    transactions: state.transactions,
    bills: state.bills,
    paychecks: state.paychecks,
  }
}

function hasMeaningfulLocalData() {
  return state.transactions.length > 0 || state.bills.length > 0 || state.paychecks.length > 0
}

function flashToast(message: string) {
  state.toast = message
  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer)
  }
  state.toastTimer = window.setTimeout(() => {
    state.toast = ''
    state.toastTimer = 0
    render()
  }, 2400)
}

function canSaveQuickAdd() {
  return Boolean(state.quickCategoryId && parseFloat(state.amountInput) > 0)
}

function normalizeMoney(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme
  document.documentElement.dataset.accent = state.settings.accentTheme
  if (state.settings.accentTheme === 'custom') {
    const accent = state.settings.customAccent || '#62b3ff'
    document.documentElement.style.setProperty('--accent', accent)
    document.documentElement.style.setProperty('--accent-2', accent)
  } else {
    document.documentElement.style.removeProperty('--accent')
    document.documentElement.style.removeProperty('--accent-2')
  }
}

function formatCurrency(value: number) {
  try {
    return new Intl.NumberFormat(state.settings.locale || undefined, {
      style: 'currency',
      currency: state.settings.currency || 'PHP',
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${state.settings.currency} ${Math.round(value).toLocaleString()}`
  }
}

function formatCurrencyDisplay(value: number) {
  try {
    return new Intl.NumberFormat(state.settings.locale || undefined, {
      style: 'currency',
      currency: state.settings.currency || 'PHP',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${state.settings.currency} ${value.toFixed(2)}`
  }
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString(state.settings.locale || undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatLongDate(iso: string) {
  return new Date(iso).toLocaleDateString(state.settings.locale || undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function todayIso() {
  return toLocalIso(new Date())
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function defaultNextCutoffDate() {
  const today = new Date()
  return toLocalIso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14))
}

function defaultLastCutoffDate(nextCutoffIso: string) {
  const nextCutoff = parseLocalDate(nextCutoffIso)
  return toLocalIso(new Date(nextCutoff.getFullYear(), nextCutoff.getMonth(), nextCutoff.getDate() - 14))
}

function normalizeCutoffDate(value: string, fallbackOffsetDays = 14) {
  const normalized = value.trim()
  if (!normalized) {
    const today = new Date()
    return toLocalIso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + fallbackOffsetDays))
  }
  const parsed = parseLocalDate(normalized)
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (fallbackOffsetDays < 0) {
    return toLocalIso(parsed)
  }
  return toLocalIso(parsed <= startOfToday ? new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() + 1) : parsed)
}

function parseLocalDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  if (!year || !month || !day) {
    const fallback = new Date()
    return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate() + 14)
  }
  return new Date(year, month - 1, day)
}

function toLocalIso(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function clampDueDay(value: number, year: number, month: number) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return Math.max(1, Math.min(daysInMonth, Math.round(value)))
}

function diffInDays(start: Date, end: Date) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
  return Math.ceil((endUtc - startUtc) / 86400000)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value)
}

function captureFocus() {
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null
  if (!active?.id) return null
  return {
    id: active.id,
    start: 'selectionStart' in active ? active.selectionStart ?? null : null,
    end: 'selectionEnd' in active ? active.selectionEnd ?? null : null,
  }
}

function restoreFocus(
  focus: {
    id: string
    start: number | null
    end: number | null
  } | null,
) {
  if (!focus) return
  const element = document.getElementById(focus.id) as HTMLInputElement | HTMLTextAreaElement | null
  if (!element) return
  element.focus()
  if (focus.start !== null && focus.end !== null && 'setSelectionRange' in element) {
    element.setSelectionRange(focus.start, focus.end)
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  const hostname = window.location.hostname
  const isLocalTest =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.')

  if (isLocalTest) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister()
      })
    })

    if ('caches' in window) {
      void caches.keys().then((keys) => {
        keys.forEach((key) => {
          void caches.delete(key)
        })
      })
    }
    return
  }

  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
}
