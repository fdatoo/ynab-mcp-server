import type { Tool } from "./defineTool.js";
import { listAccounts } from "./accounts/listAccounts.js";
import { createAccount } from "./accounts/createAccount.js";
import { createPayee } from "./payees/createPayee.js";
import { renamePayee } from "./payees/renamePayee.js";
import { createScheduledTransaction } from "./scheduled/createScheduledTransaction.js";
import { updateScheduledTransaction } from "./scheduled/updateScheduledTransaction.js";
import { deleteScheduledTransaction } from "./scheduled/deleteScheduledTransaction.js";
import { listCategories } from "./categories/listCategories.js";
import { assign } from "./categories/assign.js";
import { autoAssign } from "./categories/autoAssign.js";
import { createCategory } from "./categories/createCategory.js";
import { createCategoryGroup } from "./categories/createCategoryGroup.js";
import { getCategory } from "./categories/getCategory.js";
import { listMoneyMovements } from "./categories/listMoneyMovements.js";
import { moveMoney } from "./categories/moveMoney.js";
import { updateCategory } from "./categories/updateCategory.js";
import { updateCategoryGroup } from "./categories/updateCategoryGroup.js";
import { budgetSummary } from "./months/budgetSummary.js";
import { listMonths } from "./months/listMonths.js";
import { listPayees } from "./payees/listPayees.js";
import { listPlans } from "./plans/listPlans.js";
import { listScheduledTransactions } from "./scheduled/listScheduledTransactions.js";
import { approveTransactions } from "./transactions/approveTransactions.js";
import { getTransaction } from "./transactions/getTransaction.js";
import { createTransactions } from "./transactions/createTransactions.js";
import { deleteTransaction } from "./transactions/deleteTransaction.js";
import { searchTransactions } from "./transactions/searchTransactions.js";
import { importTransactions } from "./transactions/importTransactions.js";
import { updateTransactions } from "./transactions/updateTransactions.js";
import { reconcileAccount } from "./transactions/reconcileAccount.js";
import { spendingReport } from "./reports/spendingReport.js";

// Each entry keeps its own input type; the registry only needs the common shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: Tool<any>[] = [
  listPlans,
  budgetSummary,
  createTransactions,
  approveTransactions,
  assign,
  autoAssign,
  moveMoney,
  getCategory,
  createCategory,
  updateCategory,
  createCategoryGroup,
  updateCategoryGroup,
  listMoneyMovements,
  updateTransactions,
  getTransaction,
  listPayees,
  searchTransactions,
  deleteTransaction,
  listCategories,
  listAccounts,
  listScheduledTransactions,
  importTransactions,
  listMonths,
  reconcileAccount,
  spendingReport,
  createAccount,
  createPayee,
  renamePayee,
  createScheduledTransaction,
  updateScheduledTransaction,
  deleteScheduledTransaction,
];
