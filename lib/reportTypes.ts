export type ReportSummary = {
  month: string;

  totalFare: number;

  postpaid: number;

  rebate: number;

  cancelFee: number;

  advance: number;

  reward: number;

  discount: number;

  pending: number;

  orderCount: number;

  archivedAt: string;

  spreadsheetUrl?: string;
};

export type DispatcherRanking = {
  dispatcher: string;

  orders: number;

  fare: number;
};

export type MonthlyArchive = {
  summary: ReportSummary;

  ranking: DispatcherRanking[];

  createdAt: string;

  createdBy?: string;
};

export type ArchiveResult = {
  success: boolean;

  message?: string;
};

export type ArchiveListItem = {
  month: string;

  archivedAt: string;

  spreadsheetUrl?: string;
};

export type DashboardMonthResponse = {
  success: boolean;

  currentMonth: string;

  availableMonths: string[];

  summary: ReportSummary;

  ranking: DispatcherRanking[];
};