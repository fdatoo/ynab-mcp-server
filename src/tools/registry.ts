import type { Tool } from "./defineTool.js";
import { listAccounts } from "./accounts/listAccounts.js";
import { listCategories } from "./categories/listCategories.js";
import { updateCategoryBudget } from "./categories/updateCategoryBudget.js";
import { budgetSummary } from "./months/budgetSummary.js";
import { listMonths } from "./months/listMonths.js";
import { listPayees } from "./payees/listPayees.js";
import { listPlans } from "./plans/listPlans.js";
import { listScheduledTransactions } from "./scheduled/listScheduledTransactions.js";
import { approveTransaction } from "./transactions/approveTransaction.js";
import { bulkApproveTransactions } from "./transactions/bulkApproveTransactions.js";
import { createTransaction } from "./transactions/createTransaction.js";
import { deleteTransaction } from "./transactions/deleteTransaction.js";
import { searchTransactions } from "./transactions/searchTransactions.js";
import { importTransactions } from "./transactions/importTransactions.js";
import { updateTransaction } from "./transactions/updateTransaction.js";

// Each entry keeps its own input type; the registry only needs the common shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tools: Tool<any>[] = [
  listPlans,
  budgetSummary,
  createTransaction,
  approveTransaction,
  updateCategoryBudget,
  updateTransaction,
  bulkApproveTransactions,
  listPayees,
  searchTransactions,
  deleteTransaction,
  listCategories,
  listAccounts,
  listScheduledTransactions,
  importTransactions,
  listMonths,
];
