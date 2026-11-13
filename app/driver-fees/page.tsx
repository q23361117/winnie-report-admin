"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";

type DriverStatus =
  | "active"
  | "resting"
  | "inactive";

type DriverPlan =
  | "joint"
  | "dispatch"
  | "support"
  | "custom"
  | "other"
  | string;

type Driver = {
  id: string;
  name: string;
  plate: string;
  status: DriverStatus;
  plan: DriverPlan;
  monthlyFee: number;
  joinFee: number;
  joinedAt?: string | null;
  restStartedAt?: string | null;
  inactiveAt?: string | null;
  note: string;
};

type DriverFeeRecord = {
  id: string;
  month: string;
  driverId: string;
  driverName: string;
  plate: string;
  plan: DriverPlan;
  status: DriverStatus;
  joinedAt?: string | null;
  joinedMonth?: string | null;
  isNewDriver?: boolean;
  monthlyFee: number;
  joinFee: number;
  totalAmount: number;
  monthlyFeePaidAmount?: number;
  joinFeePaidAmount?: number;
  monthlyFeePaid?: boolean;
  joinFeePaid?: boolean;
  monthlyFeeStatus?: "unpaid" | "partial" | "paid" | "exempt";
  joinFeeStatus?: "unpaid" | "partial" | "paid" | "exempt";
  paidAmount: number;
  unpaidAmount: number;
  paid: boolean;
  paymentMethod: string;
  note: string;
  paidAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type DriverSummary = {
  total: number;
  active: number;
  resting: number;
  inactive: number;
};

type FeeSummary = {
  totalDrivers: number;
  active: number;
  resting: number;
  inactive: number;
  expectedAmount: number;
  paidAmount: number;
  unpaidAmount: number;
  paidCount: number;
  unpaidCount: number;
  retainedDrivers?: number;
  newDrivers?: number;
  monthlyFeeExpected?: number;
  monthlyFeeIncome?: number;
  monthlyFeeUnpaid?: number;
  monthlyFeePaidCount?: number;
  monthlyFeePartialCount?: number;
  monthlyFeeUnpaidCount?: number;
  monthlyFeeExemptCount?: number;
  monthlyFeePaymentRate?: number;
  joinFeeExpected?: number;
  joinFeeIncome?: number;
  joinFeeUnpaid?: number;
  joinFeeRequiredCount?: number;
  joinFeePaidCount?: number;
  joinFeeUnpaidCount?: number;
  paymentRate?: number;
};

type DriverApiResponse = {
  success: boolean;
  drivers?: Driver[];
  summary?: DriverSummary;
  message?: string;
};

type FeeApiResponse = {
  success: boolean;
  month?: string;
  records?: DriverFeeRecord[];
  summary?: FeeSummary;
  message?: string;
};

type FilterType =
  | "all"
  | "paid"
  | "partial"
  | "unpaid"
  | "active"
  | "resting"
  | "inactive";

type SortType =
  | "paid-first"
  | "unpaid-first"
  | "name"
  | "fee-desc";

type ModalMode =
  | "create"
  | "edit"
  | null;

type DriverForm = {
  name: string;
  plate: string;
  plan: "joint" | "support" | "custom";
  monthlyFee: string;
  joinFee: string;
  joinedAt: string;
  status: DriverStatus;
  note: string;
};

type BatchImportForm = {
  text: string;
  plan: "joint" | "support" | "custom";
  monthlyFee: string;
  joinFee: string;
  joinedAt: string;
  status: DriverStatus;
  note: string;
};

type ImportApiResponse = {
  success: boolean;
  message?: string;
  summary?: {
    total?: number;
    success?: number;
    created?: number;
    skipped?: number;
    failed?: number;
  };
  created?: unknown[];
  skipped?: unknown[];
  failed?: unknown[];
  errors?: unknown[];
};

type SheetDriver = {
  sourceRow?: number;
  month?: number;
  name: string;
  lineName?: string;
  plate: string;
  joinFee?: number;
  monthlyFee?: number;
  total?: number;
  expectedAmount?: number;
  paymentMethod?: string;
  paid?: boolean;
  paymentStatus?: string;
  paidRaw?: string;
  note?: string;
};

type SheetMonth = {
  month: number;
  label: string;
  sheetName: string;
};

type SheetApiResponse = {
  success: boolean;
  month?: number;
  monthLabel?: string;
  sheetName?: string;
  availableMonths?: SheetMonth[];
  drivers?: SheetDriver[];
  message?: string;
};

const EMPTY_DRIVER_FORM: DriverForm = {
  name: "",
  plate: "",
  plan: "joint",
  monthlyFee: "1500",
  joinFee: "1500",
  joinedAt: "",
  status: "active",
  note: "",
};

function money(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function getTaiwanMonth() {
  const parts =
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());

  const year =
    parts.find(
      (part) => part.type === "year"
    )?.value ?? "";

  const month =
    parts.find(
      (part) => part.type === "month"
    )?.value ?? "";

  return `${year}-${month}`;
}

function getTaiwanDate() {
  const parts =
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

  const year =
    parts.find(
      (part) => part.type === "year"
    )?.value ?? "";

  const month =
    parts.find(
      (part) => part.type === "month"
    )?.value ?? "";

  const day =
    parts.find(
      (part) => part.type === "day"
    )?.value ?? "";

  return `${year}-${month}-${day}`;
}

function monthLabel(value: string) {
  const [year, month] =
    value.split("-");

  return `${year} 年 ${Number(month)} 月`;
}

function statusLabel(
  status: DriverStatus
) {
  switch (status) {
    case "active":
      return "跑車中";

    case "resting":
      return "休息中";

    case "inactive":
      return "已退出";

    default:
      return status;
  }
}

function planLabel(plan: DriverPlan) {
  switch (plan) {
    case "joint":
    case "dispatch":
      return "聯合調度";

    case "support":
      return "支援司機";

    case "custom":
    case "other":
      return "自訂方案";

    default:
      return plan || "未設定";
  }
}

function normalizePlanForForm(
  plan: DriverPlan
): DriverForm["plan"] {
  if (
    plan === "joint" ||
    plan === "dispatch"
  ) {
    return "joint";
  }

  if (plan === "support") {
    return "support";
  }

  return "custom";
}

/*
 * 目前 /api/drivers/[id] 的 PATCH
 * 使用 dispatch / support / other。
 *
 * 新增 API 則使用
 * joint / support / custom。
 *
 * 這裡先做相容轉換。
 */
function planForPatch(
  plan: DriverForm["plan"]
) {
  switch (plan) {
    case "joint":
      return "dispatch";

    case "support":
      return "support";

    case "custom":
      return "other";
  }
}

async function readJson(
  response: Response
) {
  const text =
    await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      text ||
        `API 回傳格式錯誤 (${response.status})`
    );
  }
}

export default function DriverFeesPage() {
  const [month, setMonth] =
    useState(getTaiwanMonth());

  const [drivers, setDrivers] =
    useState<Driver[]>([]);

  const [records, setRecords] =
    useState<DriverFeeRecord[]>([]);

  const [
    driverSummary,
    setDriverSummary,
  ] = useState<DriverSummary>({
    total: 0,
    active: 0,
    resting: 0,
    inactive: 0,
  });

  const [
    feeSummary,
    setFeeSummary,
  ] = useState<FeeSummary>({
    totalDrivers: 0,
    active: 0,
    resting: 0,
    inactive: 0,
    expectedAmount: 0,
    paidAmount: 0,
    unpaidAmount: 0,
    paidCount: 0,
    unpaidCount: 0,
  });

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const [success, setSuccess] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [filter, setFilter] =
    useState<FilterType>("all");

  const [sortType, setSortType] =
    useState<SortType>("paid-first");

  const [currentPage, setCurrentPage] =
    useState(1);

  const PAGE_SIZE = 15;

  const [modalMode, setModalMode] =
    useState<ModalMode>(null);

  const [
    selectedDriver,
    setSelectedDriver,
  ] = useState<Driver | null>(null);

  const [form, setForm] =
    useState<DriverForm>({
      ...EMPTY_DRIVER_FORM,
      joinedAt: getTaiwanDate(),
    });

  const [
    paymentRecord,
    setPaymentRecord,
  ] =
    useState<DriverFeeRecord | null>(
      null
    );

  const [
    paymentMethod,
    setPaymentMethod,
  ] = useState("街口");

  const [paymentNote, setPaymentNote] =
    useState("");

  const [monthlyFeePaymentAmount, setMonthlyFeePaymentAmount] =
    useState("");

  const [joinFeePaymentAmount, setJoinFeePaymentAmount] =
    useState("");

  const [paymentDate, setPaymentDate] =
    useState(getTaiwanDate());

  const [sheetSyncOpen, setSheetSyncOpen] =
    useState(false);

  const [sheetLoading, setSheetLoading] =
    useState(false);

  const [sheetDrivers, setSheetDrivers] =
    useState<SheetDriver[]>([]);

  const [sheetName, setSheetName] =
    useState("");

  const [availableSheetMonths, setAvailableSheetMonths] =
    useState<SheetMonth[]>([]);

  const [sheetError, setSheetError] =
    useState("");

  const [creatingSheetMonth, setCreatingSheetMonth] =
    useState(false);

  const showMessage = useCallback(
    (
      type: "success" | "error",
      message: string
    ) => {
      if (type === "success") {
        setSuccess(message);
        setError("");

        window.setTimeout(() => {
          setSuccess("");
        }, 3500);
      } else {
        setError(message);
        setSuccess("");
      }
    },
    []
  );

  const loadDrivers =
    useCallback(async () => {
      const response = await fetch(
        `/api/drivers?_=${Date.now()}`,
        {
          cache: "no-store",
        }
      );

      const result =
        (await readJson(
          response
        )) as DriverApiResponse;

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.message ||
            "讀取司機資料失敗"
        );
      }

      setDrivers(
        Array.isArray(result.drivers)
          ? result.drivers
          : []
      );

      setDriverSummary(
        result.summary ?? {
          total: 0,
          active: 0,
          resting: 0,
          inactive: 0,
        }
      );
    }, []);

  const loadFees =
    useCallback(async () => {
      const response = await fetch(
        `/api/driver-fees?month=${encodeURIComponent(
          month
        )}&_=${Date.now()}`,
        {
          cache: "no-store",
        }
      );

      const result =
        (await readJson(
          response
        )) as FeeApiResponse;

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.message ||
            "讀取月費資料失敗"
        );
      }

      setRecords(
        Array.isArray(result.records)
          ? result.records
          : []
      );

      setFeeSummary(
        result.summary ?? {
          totalDrivers: 0,
          active: 0,
          resting: 0,
          inactive: 0,
          expectedAmount: 0,
          paidAmount: 0,
          unpaidAmount: 0,
          paidCount: 0,
          unpaidCount: 0,
        }
      );
    }, [month]);

  const reloadAll =
    useCallback(async () => {
      try {
        setLoading(true);
        setError("");

        await Promise.all([
          loadDrivers(),
          loadFees(),
        ]);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "資料讀取失敗"
        );
      } finally {
        setLoading(false);
      }
    }, [loadDrivers, loadFees]);

  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);

  const filteredRecords =
    useMemo(() => {
      const keyword =
        search.trim().toLowerCase();

      const filtered = records.filter(
        (record) => {
          const matchesSearch =
            !keyword ||
            record.driverName
              .toLowerCase()
              .includes(keyword) ||
            record.plate
              .toLowerCase()
              .includes(keyword) ||
            record.note
              .toLowerCase()
              .includes(keyword) ||
            planLabel(record.plan)
              .toLowerCase()
              .includes(keyword);

          let matchesFilter = true;

          switch (filter) {
            case "paid":
              matchesFilter =
                record.paid;
              break;

            case "partial":
              matchesFilter =
                !record.paid &&
                record.paidAmount > 0 &&
                record.paidAmount < record.totalAmount &&
                record.status !== "inactive";
              break;

            case "unpaid":
              matchesFilter =
                !record.paid &&
                record.paidAmount <= 0 &&
                record.totalAmount > 0 &&
                record.status !==
                  "inactive";
              break;

            case "active":
              matchesFilter =
                record.status ===
                "active";
              break;

            case "resting":
              matchesFilter =
                record.status ===
                "resting";
              break;

            case "inactive":
              matchesFilter =
                record.status ===
                "inactive";
              break;
          }

          return (
            matchesSearch &&
            matchesFilter
          );
        }
      );

      const paymentRank = (
        record: DriverFeeRecord
      ) => {
        const monthlyStatus =
          record.monthlyFeeStatus;

        if (
          monthlyStatus === "paid" ||
          record.paid === true
        ) {
          return 0;
        }

        if (
          monthlyStatus === "partial" ||
          (
            record.paidAmount > 0 &&
            record.paidAmount <
              record.totalAmount
          )
        ) {
          return 1;
        }

        if (
          monthlyStatus === "unpaid" ||
          (
            record.paidAmount <= 0 &&
            record.totalAmount > 0
          )
        ) {
          return 2;
        }

        return 3;
      };

      return [...filtered].sort(
        (a, b) => {
          if (
            sortType === "paid-first"
          ) {
            const rankDifference =
              paymentRank(a) -
              paymentRank(b);

            if (rankDifference !== 0) {
              return rankDifference;
            }
          }

          if (
            sortType === "unpaid-first"
          ) {
            const rankDifference =
              paymentRank(b) -
              paymentRank(a);

            if (rankDifference !== 0) {
              return rankDifference;
            }
          }

          if (
            sortType === "fee-desc"
          ) {
            const feeDifference =
              Number(b.monthlyFee || 0) -
              Number(a.monthlyFee || 0);

            if (feeDifference !== 0) {
              return feeDifference;
            }
          }

          return (
            a.driverName || ""
          ).localeCompare(
            b.driverName || "",
            "zh-Hant"
          );
        }
      );
    }, [
      records,
      search,
      filter,
      sortType,
    ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredRecords.length / PAGE_SIZE)
  );

  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRecords.slice(
      start,
      start + PAGE_SIZE
    );
  }, [filteredRecords, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [month, search, filter, sortType]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paymentRate =
    useMemo(() => {
      const denominator =
        feeSummary.paidCount +
        feeSummary.unpaidCount;

      if (!denominator) {
        return 0;
      }

      return (
        (feeSummary.paidCount /
          denominator) *
        100
      );
    }, [feeSummary]);

  const retainedCount = useMemo(
    () => feeSummary.retainedDrivers ?? records.filter((record) => record.status !== "inactive").length,
    [feeSummary.retainedDrivers, records]
  );

  const joinedThisMonthCount = useMemo(
    () => feeSummary.newDrivers ?? records.filter((record) => record.isNewDriver === true).length,
    [feeSummary.newDrivers, records]
  );

  const partialPaidCount = useMemo(
    () => records.filter((record) =>
      record.status !== "inactive" &&
      !record.paid &&
      record.paidAmount > 0 &&
      record.paidAmount < record.totalAmount
    ).length,
    [records]
  );

  const driverById = useMemo(() => {
    return new Map(drivers.map((driver) => [driver.id, driver]));
  }, [drivers]);

  function openCreateModal() {
    setSelectedDriver(null);

    setForm({
      ...EMPTY_DRIVER_FORM,
      joinedAt: getTaiwanDate(),
    });

    setModalMode("create");
  }

  function openEditModal(
    driverId: string
  ) {
    const driver =
      drivers.find(
        (item) =>
          item.id === driverId
      );

    if (!driver) {
      showMessage(
        "error",
        "找不到司機主檔資料"
      );
      return;
    }

    setSelectedDriver(driver);

    setForm({
      name: driver.name || "",
      plate: driver.plate || "",
      plan: normalizePlanForForm(
        driver.plan
      ),
      monthlyFee: String(
        driver.monthlyFee ?? 0
      ),
      joinFee: String(
        driver.joinFee ?? 0
      ),
      joinedAt:
        typeof driver.joinedAt ===
          "string" &&
        driver.joinedAt.length >= 10
          ? driver.joinedAt.slice(0, 10)
          : "",
      status:
        driver.status || "active",
      note: driver.note || "",
    });

    setModalMode("edit");
  }

  function closeDriverModal() {
    if (saving) {
      return;
    }

    setModalMode(null);
    setSelectedDriver(null);
  }

  function handlePlanChange(
    value: DriverForm["plan"]
  ) {
    let defaultFee =
      form.monthlyFee;

    if (value === "joint") {
      defaultFee = "1500";
    }

    if (value === "support") {
      defaultFee = "1000";
    }

    if (value === "custom") {
      defaultFee = "0";
    }

    setForm((current) => ({
      ...current,
      plan: value,
      monthlyFee: defaultFee,
    }));
  }

  async function saveDriver(
    event: FormEvent
  ) {
    event.preventDefault();

    if (!form.name.trim()) {
      showMessage(
        "error",
        "請輸入司機名稱"
      );
      return;
    }

    if (!form.plate.trim()) {
      showMessage(
        "error",
        "請輸入車牌／顏色"
      );
      return;
    }

    try {
      setSaving(true);
      setError("");

      if (modalMode === "create") {
        const response = await fetch(
          "/api/drivers",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              name: form.name.trim(),
              plate: form.plate.trim(),
              plan: form.plan,
              monthlyFee: Number(
                form.monthlyFee || 0
              ),
              joinFee: Number(
                form.joinFee || 0
              ),
              joinedAt:
                form.joinedAt ||
                getTaiwanDate(),
              status: form.status,
              note: form.note.trim(),
            }),
          }
        );

        const result =
          await readJson(response);

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.message ||
              "新增司機失敗"
          );
        }

        setModalMode(null);

        showMessage(
          "success",
          `${form.name} 已新增成功`
        );
      }

      if (
        modalMode === "edit" &&
        selectedDriver
      ) {
        const response = await fetch(
          `/api/drivers/${encodeURIComponent(
            selectedDriver.id
          )}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              name: form.name.trim(),
              plate: form.plate.trim(),
              plan: planForPatch(
                form.plan
              ),
              monthlyFee: Number(
                form.monthlyFee || 0
              ),
              joinFee: Number(
                form.joinFee || 0
              ),
              joinedAt:
                form.joinedAt || null,
              status: form.status,
              note: form.note.trim(),
            }),
          }
        );

        const result =
          await readJson(response);

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.message ||
              "修改司機失敗"
          );
        }

        setModalMode(null);
        setSelectedDriver(null);

        showMessage(
          "success",
          `${form.name} 資料已更新`
        );
      }

      await reloadAll();
    } catch (err) {
      showMessage(
        "error",
        err instanceof Error
          ? err.message
          : "儲存失敗"
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(
    driverId: string,
    status: DriverStatus
  ) {
    const driver =
      drivers.find(
        (item) =>
          item.id === driverId
      );

    if (!driver) {
      return;
    }

    const text =
      status === "active"
        ? "恢復跑車"
        : status === "resting"
        ? "設定休息"
        : "設定退出";

    if (
      !window.confirm(
        `確定要將「${driver.name}」${text}嗎？`
      )
    ) {
      return;
    }

    try {
      setSaving(true);

      const response = await fetch(
        `/api/drivers/${encodeURIComponent(
          driverId
        )}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            status,
          }),
        }
      );

      const result =
        await readJson(response);

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.message ||
            "狀態更新失敗"
        );
      }

      showMessage(
        "success",
        `${driver.name} 已${text}`
      );

      await reloadAll();
    } catch (err) {
      showMessage(
        "error",
        err instanceof Error
          ? err.message
          : "狀態更新失敗"
      );
    } finally {
      setSaving(false);
    }
  }

  async function createCurrentMonthSheet() {
    const label = monthLabel(month);

    if (
      !window.confirm(
        `確定要建立「${label}」司機月費試算表嗎？\n\n系統會自動複製上一月份的司機名單與格式，並重置新月份的繳費資料。`
      )
    ) {
      return;
    }

    try {
      setCreatingSheetMonth(true);
      setError("");
      setSuccess("");

      const response = await fetch(
        "/api/driver-fees/create-month",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            month,
          }),
        }
      );

      const result = await readJson(response);

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.message ||
            "建立月份報表失敗"
        );
      }

      const created =
        result.created === true;

      const alreadyExists =
        result.alreadyExists === true;

      const createdSheetName =
        String(
          result.sheetName ||
            `${Number(month.split("-")[1])}月司機繳費`
        );

      if (alreadyExists) {
        showMessage(
          "success",
          `「${createdSheetName}」已經存在，已直接載入試算表資料`
        );
      } else if (created) {
        showMessage(
          "success",
          `「${createdSheetName}」建立成功`
        );
      } else {
        showMessage(
          "success",
          result.message ||
            `「${createdSheetName}」處理完成`
        );
      }

      // 建立成功後直接開啟同步預覽，
      // 不需要重新整理頁面或再次按「從試算表同步」。
      setSheetSyncOpen(true);
      setSheetDrivers([]);
      setSheetName("");
      setAvailableSheetMonths([]);
      setSheetError("");

      await loadSheetPreview();

    } catch (err) {
      showMessage(
        "error",
        err instanceof Error
          ? err.message
          : "建立月份報表失敗"
      );
    } finally {
      setCreatingSheetMonth(false);
    }
  }

  async function openSheetSync() {
    // 先打開視窗，再依目前選擇月份讀取試算表。
    // 注意：不要在這裡依賴舊 state，loadSheetPreview 會直接使用目前 month。
    setSheetSyncOpen(true);
    setSheetDrivers([]);
    setSheetName("");
    setAvailableSheetMonths([]);
    setSheetError("");

    await loadSheetPreview();
  }

  async function loadSheetPreview() {
    try {
      setSheetLoading(true);
      setSheetError("");

      const selectedMonth = Number(month.split("-")[1]);

      if (!Number.isInteger(selectedMonth) || selectedMonth < 1 || selectedMonth > 12) {
        throw new Error("月份格式錯誤，請重新選擇月份");
      }

      const response = await fetch(
        `/api/drivers/sheets?month=${selectedMonth}&_=${Date.now()}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        }
      );

      const raw = (await readJson(response)) as any;

      if (!response.ok) {
        throw new Error(
          raw?.message ||
            raw?.error ||
            `讀取司機月費試算表失敗 (${response.status})`
        );
      }

      // 相容三種 API 回傳：
      // 1. { success, drivers, sheetName, availableMonths }
      // 2. { success, data: { drivers, ... } }
      // 3. Apps Script 中文欄位（避免瀏覽器/舊版 API 欄位不同造成 0 位）
      const payload =
        raw?.data && typeof raw.data === "object"
          ? raw.data
          : raw;

      const successValue =
        raw?.success ??
        payload?.success ??
        raw?.成功 ??
        payload?.成功 ??
        true;

      if (successValue === false) {
        throw new Error(
          raw?.message ||
            payload?.message ||
            raw?.訊息 ||
            payload?.訊息 ||
            "讀取司機月費試算表失敗"
        );
      }

      const rawDrivers =
        payload?.drivers ??
        raw?.drivers ??
        payload?.司機 ??
        raw?.司機 ??
        [];

      const rawMonths =
        payload?.availableMonths ??
        raw?.availableMonths ??
        payload?.可用月份 ??
        raw?.可用月份 ??
        [];

      const resolvedSheetName = String(
        payload?.sheetName ??
          raw?.sheetName ??
          payload?.工作表名稱 ??
          raw?.工作表名稱 ??
          ""
      );

      const normalizedDrivers: SheetDriver[] = Array.isArray(rawDrivers)
        ? rawDrivers
            .map((item: any, index: number) => ({
              sourceRow: Number(
                item?.sourceRow ?? item?.來源列 ?? index + 3
              ),
              month: Number(
                item?.month ?? item?.月份 ?? selectedMonth
              ),
              name: String(
                item?.name ??
                  item?.lineName ??
                  item?.司機LINE名 ??
                  item?.司機 ??
                  item?.名稱 ??
                  ""
              ).trim(),
              lineName: String(
                item?.lineName ??
                  item?.name ??
                  item?.司機LINE名 ??
                  item?.司機 ??
                  ""
              ).trim(),
              plate: String(
                item?.plate ??
                  item?.車牌 ??
                  item?.["車牌／顏色"] ??
                  item?.["車牌/顏色"] ??
                  ""
              ).trim(),
              joinFee: Number(
                item?.joinFee ?? item?.入會費 ?? 0
              ) || 0,
              monthlyFee: Number(
                item?.monthlyFee ?? item?.月費 ?? 0
              ) || 0,
              total: Number(
                item?.total ?? item?.總計 ?? 0
              ) || 0,
              expectedAmount: Number(
                item?.expectedAmount ??
                  item?.應繳 ??
                  item?.total ??
                  item?.總計 ??
                  0
              ) || 0,
              paymentMethod: String(
                item?.paymentMethod ?? item?.繳費方式 ?? ""
              ).trim(),
              paid: Boolean(
                item?.paid ??
                  item?.已支付 ??
                  item?.是否繳交 ??
                  false
              ),
              paymentStatus: String(
                item?.paymentStatus ?? item?.繳費狀態 ?? ""
              ).trim(),
              paidRaw: String(
                item?.paidRaw ?? item?.是否繳交 ?? ""
              ).trim(),
              note: String(
                item?.note ?? item?.備註 ?? ""
              ).trim(),
            }))
            // 試算表至少要有司機名稱才顯示。
            // 車牌空白仍可預覽，但真正同步時會再排除。
            .filter((item: SheetDriver) => item.name.length > 0)
        : [];

      const normalizedMonths: SheetMonth[] = Array.isArray(rawMonths)
        ? rawMonths
            .map((item: any) => ({
              month: Number(item?.month ?? item?.月份 ?? 0),
              label: String(
                item?.label ??
                  item?.標籤 ??
                  `${Number(item?.month ?? item?.月份 ?? 0)}月`
              ),
              sheetName: String(
                item?.sheetName ?? item?.工作表名稱 ?? ""
              ),
            }))
            .filter(
              (item: SheetMonth) =>
                Number.isInteger(item.month) &&
                item.month >= 1 &&
                item.month <= 12
            )
        : [];

      console.log("[司機月費同步] API 原始資料：", raw);
      console.log("[司機月費同步] 月份：", selectedMonth);
      console.log("[司機月費同步] 工作表：", resolvedSheetName);
      console.log("[司機月費同步] 司機數：", normalizedDrivers.length);

      setSheetDrivers(normalizedDrivers);
      setSheetName(
        resolvedSheetName ||
          (normalizedDrivers.length > 0
            ? `${selectedMonth}月司機繳費`
            : "")
      );
      setAvailableSheetMonths(normalizedMonths);

      if (normalizedDrivers.length === 0) {
        setSheetError(
          resolvedSheetName
            ? `已找到「${resolvedSheetName}」，但沒有讀到可同步的司機資料。`
            : `API 已連線，但沒有讀到 ${selectedMonth} 月的工作表資料。`
        );
      }
    } catch (err) {
      setSheetDrivers([]);
      setSheetName("");
      setAvailableSheetMonths([]);

      const message =
        err instanceof Error
          ? err.message
          : "讀取司機月費試算表失敗";

      setSheetError(message);
      showMessage("error", message);
    } finally {
      setSheetLoading(false);
    }
  }

  async function syncFromSheet() {
    if (sheetDrivers.length === 0) {
      showMessage(
        "error",
        "目前沒有可同步的司機資料"
      );
      return;
    }

    if (
      !window.confirm(
        `確定要把「${sheetName || `${Number(month.split("-")[1])}月司機繳費`}」的 ${sheetDrivers.length} 位司機同步到 ${monthLabel(month)}帳本嗎？\n\n系統會同步司機主檔，並建立／更新這個月份的 driverFeeRecords；不會因司機主檔已存在就跳過月費帳本。`
      )
    ) {
      return;
    }

    try {
      setSaving(true);
      setError("");

      /*
       * 這裡改用月費專用同步 API。
       *
       * 舊版 /api/drivers/import 只處理 drivers 主檔，
       * 因此 53 位既有司機會全部被判定為「重複跳過」，
       * 不會建立 9 月 driverFeeRecords。
       *
       * /api/driver-fees/sync-sheet 會：
       * 1. 讀取指定月份試算表
       * 2. 比對／建立 drivers 主檔
       * 3. 建立或更新該月份 driverFeeRecords
       */
      const response = await fetch(
        "/api/driver-fees/sync-sheet",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Accept: "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            month,
            overwrite: true,
          }),
        }
      );

      const result =
        (await readJson(
          response
        )) as any;

      if (
        !response.ok ||
        !result?.success
      ) {
        throw new Error(
          result?.message ||
            result?.error ||
            "從試算表同步月費帳本失敗"
        );
      }

      /*
       * sync-sheet 不同版本可能使用不同 summary 欄位，
       * 這裡做相容顯示。
       */
      const summary =
        result?.summary &&
        typeof result.summary === "object"
          ? result.summary
          : {};

      const syncedCount =
        Number(
          summary.synced ??
            summary.updated ??
            summary.success ??
            summary.total ??
            result?.synced ??
            result?.updated ??
            result?.records?.length ??
            sheetDrivers.length
        ) || 0;

      const createdDrivers =
        Number(
          summary.createdDrivers ??
            summary.created ??
            result?.createdDrivers ??
            result?.created?.length ??
            0
        ) || 0;

      const failedCount =
        Number(
          summary.failed ??
            result?.failed?.length ??
            result?.errors?.length ??
            0
        ) || 0;

      setSheetSyncOpen(false);

      /*
       * 先重新讀取司機主檔與月份帳本。
       * GET /api/driver-fees 現在只會顯示真正存在的
       * driverFeeRecords，所以同步完成後明細會直接出現。
       */
      await reloadAll();

      showMessage(
        "success",
        `試算表同步完成：${monthLabel(month)}帳本已同步 ${syncedCount} 位${
          createdDrivers > 0
            ? `，新增主檔 ${createdDrivers} 位`
            : ""
        }${
          failedCount > 0
            ? `，失敗 ${failedCount} 位`
            : ""
        }`
      );
    } catch (err) {
      showMessage(
        "error",
        err instanceof Error
          ? err.message
          : "從試算表同步月費帳本失敗"
      );
    } finally {
      setSaving(false);
    }
  }

  function openPayment(
    record: DriverFeeRecord
  ) {
    setPaymentRecord(record);

    setPaymentMethod(
      record.paymentMethod ||
        "街口"
    );

    setPaymentNote(
      record.note || ""
    );

    setMonthlyFeePaymentAmount(
      String(record.monthlyFeePaidAmount ?? (record.paid ? record.monthlyFee : 0))
    );

    setJoinFeePaymentAmount(
      String(record.joinFeePaidAmount ?? (record.paid ? record.joinFee : 0))
    );

    setPaymentDate(
      record.paidAt && record.paidAt.length >= 10
        ? record.paidAt.slice(0, 10)
        : getTaiwanDate()
    );
  }

  async function savePayment(
    paid: boolean
  ) {
    if (!paymentRecord) {
      return;
    }

    try {
      setSaving(true);

      const response = await fetch(
        "/api/driver-fees",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            month,
            driverId:
              paymentRecord.driverId,
            monthlyFee:
              paymentRecord.monthlyFee,
            joinFee:
              paymentRecord.joinFee,
            monthlyFeePaidAmount: paid
              ? Math.max(0, Number(monthlyFeePaymentAmount || 0))
              : 0,
            joinFeePaidAmount: paid
              ? Math.max(0, Number(joinFeePaymentAmount || 0))
              : 0,
            paidAmount: paid
              ? Math.max(0, Number(monthlyFeePaymentAmount || 0)) +
                Math.max(0, Number(joinFeePaymentAmount || 0))
              : 0,
            paid: paid
              ? Math.max(0, Number(monthlyFeePaymentAmount || 0)) >= paymentRecord.monthlyFee &&
                Math.max(0, Number(joinFeePaymentAmount || 0)) >= paymentRecord.joinFee
              : false,
            paymentMethod: paid
              ? paymentMethod
              : "",
            paidAt: paid ? paymentDate : null,
            note:
              paymentNote.trim(),
          }),
        }
      );

      const result =
        await readJson(response);

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.message ||
            "繳費紀錄更新失敗"
        );
      }

      const name =
        paymentRecord.driverName;

      setPaymentRecord(null);

      showMessage(
        "success",
        paid
          ? `${name} 的 ${monthLabel(month)} 繳費紀錄已更新`
          : `${name} 已改為未繳`
      );

      await loadFees();
    } catch (err) {
      showMessage(
        "error",
        err instanceof Error
          ? err.message
          : "繳費紀錄更新失敗"
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteMonthlyFeeRecord(
    record: DriverFeeRecord
  ) {
    if (
      !window.confirm(
        `確定要刪除「${record.driverName}」${monthLabel(month)}的月費紀錄嗎？\n\n只會刪除這個月份的月費紀錄，不會刪除司機主檔，也不會影響其他月份。`
      )
    ) {
      return;
    }

    try {
      setSaving(true);

      const response = await fetch(
        `/api/driver-fees/${encodeURIComponent(
          record.driverId
        )}?month=${encodeURIComponent(month)}`,
        {
          method: "DELETE",
          cache: "no-store",
        }
      );

      const result = await readJson(response);

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            "刪除本月月費紀錄失敗"
        );
      }

      showMessage(
        "success",
        `${record.driverName} 的 ${monthLabel(month)}月費紀錄已刪除`
      );

      await loadFees();
    } catch (err) {
      showMessage(
        "error",
        err instanceof Error
          ? err.message
          : "刪除本月月費紀錄失敗"
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteDriver(
    driverId: string
  ) {
    const driver =
      drivers.find(
        (item) =>
          item.id === driverId
      );

    if (!driver) {
      return;
    }

    if (
      !window.confirm(
        `⚠️ 確定永久刪除「${driver.name}」嗎？\n\n如果只是暫時不跑，建議使用「休息中」；如果已離開車隊，建議使用「已退出」。`
      )
    ) {
      return;
    }

    if (
      !window.confirm(
        `再次確認：真的要永久刪除 ${driver.name}？`
      )
    ) {
      return;
    }

    try {
      setSaving(true);

      const response = await fetch(
        `/api/drivers/${encodeURIComponent(
          driverId
        )}`,
        {
          method: "DELETE",
        }
      );

      const result =
        await readJson(response);

      if (
        !response.ok ||
        !result.success
      ) {
        throw new Error(
          result.message ||
            "刪除失敗"
        );
      }

      showMessage(
        "success",
        `${driver.name} 已刪除`
      );

      await reloadAll();
    } catch (err) {
      showMessage(
        "error",
        err instanceof Error
          ? err.message
          : "刪除失敗"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-[240px] shrink-0 bg-[#0d1b2e] text-white lg:flex lg:flex-col">
          <div className="px-7 pb-7 pt-8">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 text-xl">
                🚕
              </div>

              <div>
                <div className="text-lg font-bold">
                  維尼車隊
                </div>
                <div className="text-xs text-slate-400">
                  營運管理系統
                </div>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 px-4">
            <SideLink
              href="/"
              icon="▦"
              label="營運總覽"
            />

            <SideLink
              href="/analytics"
              icon="▥"
              label="調度與財務"
            />

            <div className="pb-2 pt-5">
              <p className="px-4 text-[11px] font-semibold tracking-wider text-slate-500">
                財務管理
              </p>
            </div>

            <SideLink
              href="/driver-fees"
              icon="🚕"
              label="司機月費"
              active
            />

            <div className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-500">
              <span>👨‍💼</span>
              調度薪資
            </div>

            <div className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-slate-500">
              <span>💰</span>
              月結總帳
            </div>

            <div className="pb-2 pt-5">
              <p className="px-4 text-[11px] font-semibold tracking-wider text-slate-500">
                會員營運
              </p>
            </div>

            <SideLink
              href="/members"
              icon="♟"
              label="會員管理"
            />

            <SideLink
              href="/points"
              icon="☆"
              label="集點紀錄"
            />

            <SideLink
              href="/postpaid"
              icon="▤"
              label="後結帳務"
            />

            <SideLink
              href="/credits"
              icon="▭"
              label="乘車金管理"
            />
          </nav>

          <div className="m-5 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Firebase 已連線
            </div>

            <p className="mt-2 text-xs leading-5 text-slate-400">
              司機主檔＋每月月費
              <br />
              正式資料模式
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1600px] px-5 py-7 sm:px-8 lg:px-10">
            <header className="mb-7">
              <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
                <div>
                  <p className="text-sm font-bold text-blue-600">
                    財務管理中心
                  </p>

                  <h1 className="mt-1 text-3xl font-black tracking-tight">
                    司機與月費管理
                  </h1>

                  <p className="mt-2 text-sm text-slate-500">
                    統一管理司機名單、跑車狀態、方案、月費與每月繳費紀錄
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                    <p className="text-xs text-slate-400">
                      報表月份
                    </p>

                    <input
                      type="month"
                      value={month}
                      onChange={(event) =>
                        setMonth(
                          event.target.value
                        )
                      }
                      className="mt-1 bg-transparent text-sm font-bold outline-none"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      void reloadAll()
                    }
                    disabled={loading}
                    className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    ↻ 重新整理
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void createCurrentMonthSheet()
                    }
                    disabled={
                      creatingSheetMonth ||
                      sheetLoading ||
                      saving
                    }
                    className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingSheetMonth
                      ? "建立中..."
                      : "＋ 建立本月報表"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void openSheetSync()}
                    disabled={
                      creatingSheetMonth ||
                      sheetLoading
                    }
                    className="rounded-2xl border border-blue-200 bg-blue-50 px-5 py-3 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    🔄 從試算表同步
                  </button>

                  <button
                    type="button"
                    onClick={
                      openCreateModal
                    }
                    className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700"
                  >
                    ＋ 新增司機
                  </button>
                </div>
              </div>
            </header>

            {error && (
              <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
                ⚠️ {error}
              </div>
            )}

            {success && (
              <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-700">
                ✓ {success}
              </div>
            )}

            <section className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-blue-700">
                    🚕{" "}
                    {monthLabel(month)}
                    司機月費報表
                  </p>

                  <p className="mt-1 text-xs text-blue-600/70">
                    資料由 Firebase
                    即時讀取；切換月份即可查看不同月份的月費紀錄。
                  </p>
                </div>

                <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-blue-600">
                  {loading
                    ? "讀取中..."
                    : `${records.length} 位司機`}
                </span>
              </div>
            </section>

            <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="本月應收"
                value={money(
                  feeSummary.expectedAmount
                )}
                description="有效司機本月應收總額"
              />

              <SummaryCard
                label="本月已收"
                value={money(
                  feeSummary.paidAmount
                )}
                description={`${feeSummary.paidCount} 位已完成繳費`}
                accent="emerald"
              />

              <SummaryCard
                label="本月未收"
                value={money(
                  feeSummary.unpaidAmount
                )}
                description={`${feeSummary.unpaidCount} 位尚未完成`}
                accent="rose"
              />

              <SummaryCard
                label="繳費率"
                value={`${paymentRate.toFixed(
                  1
                )}%`}
                description={`${feeSummary.paidCount} 已繳 / ${feeSummary.unpaidCount} 未繳`}
                accent="blue"
              />
            </section>

            <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="月費實收"
                value={money(feeSummary.monthlyFeeIncome ?? 0)}
                description={`應收 ${money(feeSummary.monthlyFeeExpected ?? 0)}｜未收 ${money(feeSummary.monthlyFeeUnpaid ?? 0)}`}
                accent="emerald"
              />
              <SummaryCard
                label="月費已繳"
                value={`${feeSummary.monthlyFeePaidCount ?? 0} 位`}
                description={`未繳 ${feeSummary.monthlyFeeUnpaidCount ?? 0} 位｜部分繳 ${feeSummary.monthlyFeePartialCount ?? 0} 位`}
                accent="blue"
              />
              <SummaryCard
                label="入會費實收"
                value={money(feeSummary.joinFeeIncome ?? 0)}
                description={`應收 ${money(feeSummary.joinFeeExpected ?? 0)}｜未收 ${money(feeSummary.joinFeeUnpaid ?? 0)}`}
                accent="emerald"
              />
              <SummaryCard
                label="入會費狀態"
                value={`${feeSummary.joinFeePaidCount ?? 0} 位已繳`}
                description={`${feeSummary.joinFeeUnpaidCount ?? 0} 位待繳`}
                accent="rose"
              />
            </section>

            <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="本月留隊"
                value={`${retainedCount} 位`}
                description="跑車中＋休息中，排除已退出"
                accent="blue"
              />
              <SummaryCard
                label="本月新加入"
                value={`${joinedThisMonthCount} 位`}
                description={`加入日期落在 ${monthLabel(month)}`}
                accent="emerald"
              />
              <SummaryCard
                label="部分繳費"
                value={`${partialPaidCount} 位`}
                description="已有付款，但尚未繳清"
              />
              <SummaryCard
                label="本月有效紀錄"
                value={`${records.filter((record) => record.status !== "inactive").length} 位`}
                description="可用於核對本月留隊名單"
              />
            </section>

            <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatusCard
                icon="🚕"
                label="跑車中"
                value={
                  driverSummary.active
                }
                onClick={() =>
                  setFilter("active")
                }
              />

              <StatusCard
                icon="☕"
                label="休息中"
                value={
                  driverSummary.resting
                }
                onClick={() =>
                  setFilter("resting")
                }
              />

              <StatusCard
                icon="🚪"
                label="已退出"
                value={
                  driverSummary.inactive
                }
                onClick={() =>
                  setFilter("inactive")
                }
              />

              <StatusCard
                icon="👥"
                label="司機總數"
                value={
                  driverSummary.total
                }
                onClick={() =>
                  setFilter("all")
                }
              />
            </section>

            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5 sm:p-6">
                <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
                  <div>
                    <h2 className="text-xl font-black">
                      {monthLabel(month)}
                      司機明細
                    </h2>

                    <p className="mt-1 text-sm text-slate-400">
                      可直接管理司機、休息狀態與繳費
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 lg:flex-row">
                    <input
                      value={search}
                      onChange={(event) =>
                        setSearch(
                          event.target.value
                        )
                      }
                      placeholder="搜尋司機、車牌、方案、備註"
                      className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-blue-400 focus:bg-white lg:w-[260px]"
                    />

                    <select
                    value={sortType}
                    onChange={(event) =>
                      setSortType(
                        event.target.value as SortType
                      )
                    }
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold outline-none focus:border-blue-400"
                    title="明細排序"
                  >
                    <option value="paid-first">
                      已繳優先
                    </option>
                    <option value="unpaid-first">
                      未繳優先
                    </option>
                    <option value="name">
                      司機名稱
                    </option>
                    <option value="fee-desc">
                      月費高 → 低
                    </option>
                  </select>

                  <select
                      value={filter}
                      onChange={(event) =>
                        setFilter(
                          event.target
                            .value as FilterType
                        )
                      }
                      className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold outline-none"
                    >
                      <option value="all">
                        全部司機
                      </option>
                      <option value="paid">
                        已繳
                      </option>
                      <option value="partial">
                        部分繳
                      </option>
                      <option value="unpaid">
                        未繳
                      </option>
                      <option value="active">
                        跑車中
                      </option>
                      <option value="resting">
                        休息中
                      </option>
                      <option value="inactive">
                        已退出
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1720px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-xs font-bold text-slate-400">
                      <th className="px-6 py-4">
                        司機
                      </th>
                      <th className="px-4 py-4">
                        車牌
                      </th>
                      <th className="px-4 py-4">
                        狀態
                      </th>
                      <th className="px-4 py-4">
                        加入月份
                      </th>
                      <th className="px-4 py-4">
                        方案
                      </th>
                      <th className="px-4 py-4 text-right">
                        入會費
                      </th>
                      <th className="px-4 py-4">
                        入會費狀態
                      </th>
                      <th className="px-4 py-4 text-right">
                        月費
                      </th>
                      <th className="px-4 py-4 text-right">
                        應繳
                      </th>
                      <th className="px-4 py-4 text-right">
                        已繳
                      </th>
                      <th className="px-4 py-4">
                        繳費方式
                      </th>
                      <th className="px-4 py-4">
                        繳費狀態
                      </th>
                      <th className="px-4 py-4">
                        備註
                      </th>
                      <th className="px-6 py-4 text-right">
                        操作
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {loading ? (
                      <tr>
                        <td
                          colSpan={14}
                          className="px-6 py-20 text-center text-sm text-slate-400"
                        >
                          正在讀取司機資料...
                        </td>
                      </tr>
                    ) : (
                      paginatedRecords.map(
                        (record) => (
                          <tr
                            key={
                              record.driverId
                            }
                            className="border-b border-slate-100 transition last:border-b-0 hover:bg-slate-50/70"
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 font-black text-blue-600">
                                  {record.driverName
                                    .trim()
                                    .charAt(
                                      0
                                    ) ||
                                    "司"}
                                </div>

                                <div>
                                  <p className="font-bold">
                                    {
                                      record.driverName
                                    }
                                  </p>
                                </div>
                              </div>
                            </td>

                            <td className="px-4 py-4">
                              <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm font-semibold">
                                {
                                  record.plate
                                }
                              </span>
                            </td>

                            <td className="px-4 py-4">
                              <DriverStatusBadge
                                status={
                                  record.status
                                }
                              />
                            </td>

                            <td className="px-4 py-4 text-sm font-semibold text-slate-600">
                              {(() => {
                                const joinedMonth =
                                  record.joinedMonth ||
                                  record.joinedAt?.slice(0, 7) ||
                                  driverById.get(record.driverId)?.joinedAt?.slice(0, 7);
                                if (!joinedMonth) return "待補資料";
                                const [y, m] = joinedMonth.split("-");
                                return `${y}/${Number(m)}月${record.isNewDriver ? "・本月新加入" : ""}`;
                              })()}
                            </td>

                            <td className="px-4 py-4 text-sm font-semibold">
                              {planLabel(
                                record.plan
                              )}
                            </td>

                            <td className="px-4 py-4 text-right font-semibold">
                              {record.joinFee
                                ? money(
                                    record.joinFee
                                  )
                                : "—"}
                            </td>

                            <td className="px-4 py-4">
                              {record.joinFee <= 0 ? (
                                <span className="text-xs font-bold text-slate-400">免收</span>
                              ) : record.joinFeePaid ? (
                                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">● 已繳</span>
                              ) : record.joinFeeStatus === "partial" ? (
                                <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">● 部分繳</span>
                              ) : (
                                <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600">● 待繳</span>
                              )}
                            </td>

                            <td className="px-4 py-4 text-right font-semibold">
                              {money(
                                record.monthlyFee
                              )}
                            </td>

                            <td className="px-4 py-4 text-right font-black">
                              {money(
                                record.totalAmount
                              )}
                            </td>

                            <td className="px-4 py-4 text-right font-bold text-emerald-600">
                              {money(
                                record.paidAmount
                              )}
                            </td>

                            <td className="px-4 py-4 text-sm">
                              {record.paymentMethod ||
                                "—"}
                            </td>

                            <td className="px-4 py-4">
                              <PaymentBadge
                                paid={record.paid}
                                paidAmount={record.paidAmount}
                                totalAmount={record.totalAmount}
                                status={record.status}
                              />
                            </td>

                            <td className="max-w-[200px] px-4 py-4 text-sm text-slate-500">
                              {record.note ||
                                "—"}
                            </td>

                            <td className="px-6 py-4">
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openEditModal(
                                      record.driverId
                                    )
                                  }
                                  className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold hover:bg-slate-200"
                                >
                                  編輯
                                </button>

                                {record.status ===
                                  "active" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void changeStatus(
                                        record.driverId,
                                        "resting"
                                      )
                                    }
                                    className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100"
                                  >
                                    休息
                                  </button>
                                )}

                                {record.status ===
                                  "resting" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void changeStatus(
                                        record.driverId,
                                        "active"
                                      )
                                    }
                                    className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                                  >
                                    恢復
                                  </button>
                                )}

                                {record.status !==
                                  "inactive" && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openPayment(
                                        record
                                      )
                                    }
                                    className={`rounded-lg px-3 py-2 text-xs font-bold ${
                                      record.paid
                                        ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                        : "bg-blue-600 text-white hover:bg-blue-700"
                                    }`}
                                  >
                                    {record.paid
                                      ? "繳費資料"
                                      : "確認繳費"}
                                  </button>
                                )}

                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() =>
                                    void deleteMonthlyFeeRecord(
                                      record
                                    )
                                  }
                                  className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                                  title={`只刪除 ${monthLabel(month)} 的月費紀錄`}
                                >
                                  🗑️ 刪除
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      )
                    )}

                    {!loading &&
                      filteredRecords.length ===
                        0 && (
                        <tr>
                          <td
                            colSpan={14}
                            className="px-6 py-20 text-center"
                          >
                            <div className="text-3xl">
                              🔎
                            </div>
                            <p className="mt-3 font-bold text-slate-600">
                              找不到符合條件的司機
                            </p>
                          </td>
                        </tr>
                      )}
                  </tbody>
                </table>
              </div>

              {!loading && filteredRecords.length > 0 && (
                <div className="flex flex-col gap-3 border-t border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">
                    共 <span className="font-bold text-slate-800">{filteredRecords.length}</span> 位司機，
                    每頁 {PAGE_SIZE} 位｜第{" "}
                    <span className="font-bold text-slate-800">{currentPage}</span> / {totalPages} 頁
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage(1)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      第一頁
                    </button>

                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() =>
                        setCurrentPage((page) =>
                          Math.max(1, page - 1)
                        )
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ← 上一頁
                    </button>

                    {Array.from(
                      { length: totalPages },
                      (_, index) => index + 1
                    )
                      .filter(
                        (page) =>
                          page === 1 ||
                          page === totalPages ||
                          Math.abs(page - currentPage) <= 2
                      )
                      .map((page, index, pages) => (
                        <span
                          key={page}
                          className="contents"
                        >
                          {index > 0 &&
                            page - pages[index - 1] > 1 && (
                              <span className="px-1 text-xs text-slate-400">
                                …
                              </span>
                            )}

                          <button
                            type="button"
                            onClick={() =>
                              setCurrentPage(page)
                            }
                            className={`min-w-9 rounded-lg px-3 py-2 text-xs font-bold transition ${
                              currentPage === page
                                ? "bg-blue-600 text-white"
                                : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {page}
                          </button>
                        </span>
                      ))}

                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={() =>
                        setCurrentPage((page) =>
                          Math.min(totalPages, page + 1)
                        )
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一頁 →
                    </button>

                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={() =>
                        setCurrentPage(totalPages)
                      }
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      最後一頁
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      {modalMode && (
        <Modal
          title={
            modalMode === "create"
              ? "新增司機"
              : "編輯司機資料"
          }
          onClose={
            closeDriverModal
          }
        >
          <form
            onSubmit={saveDriver}
            className="space-y-5"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="司機名稱 *">
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm(
                      (current) => ({
                        ...current,
                        name: event
                          .target.value,
                      })
                    )
                  }
                  className="form-input"
                  placeholder="例如：菲比"
                />
              </FormField>

              <FormField label="車牌／顏色 *">
                <input
                  value={form.plate}
                  onChange={(event) =>
                    setForm(
                      (current) => ({
                        ...current,
                        plate:
                          event.target
                            .value,
                      })
                    )
                  }
                  className="form-input"
                  placeholder="例如：7975灰"
                />
              </FormField>

              <FormField label="司機方案">
                <select
                  value={form.plan}
                  onChange={(event) =>
                    handlePlanChange(
                      event.target
                        .value as DriverForm["plan"]
                    )
                  }
                  className="form-input"
                >
                  <option value="joint">
                    維尼聯合調度
                  </option>
                  <option value="support">
                    維尼支援司機
                  </option>
                  <option value="custom">
                    自訂方案
                  </option>
                </select>
              </FormField>

              <FormField label="目前狀態">
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm(
                      (current) => ({
                        ...current,
                        status:
                          event.target
                            .value as DriverStatus,
                      })
                    )
                  }
                  className="form-input"
                >
                  <option value="active">
                    跑車中
                  </option>
                  <option value="resting">
                    休息中
                  </option>
                  <option value="inactive">
                    已退出
                  </option>
                </select>
              </FormField>

              <FormField label="每月月費">
                <input
                  type="number"
                  min="0"
                  value={
                    form.monthlyFee
                  }
                  onChange={(event) =>
                    setForm(
                      (current) => ({
                        ...current,
                        monthlyFee:
                          event.target
                            .value,
                      })
                    )
                  }
                  className="form-input"
                />
              </FormField>

              <FormField label="入會費">
                <input
                  type="number"
                  min="0"
                  value={form.joinFee}
                  onChange={(event) =>
                    setForm(
                      (current) => ({
                        ...current,
                        joinFee:
                          event.target
                            .value,
                      })
                    )
                  }
                  className="form-input"
                />
              </FormField>

              <FormField label="加入日期">
                <input
                  type="date"
                  value={
                    form.joinedAt
                  }
                  onChange={(event) =>
                    setForm(
                      (current) => ({
                        ...current,
                        joinedAt:
                          event.target
                            .value,
                      })
                    )
                  }
                  className="form-input"
                />
              </FormField>
            </div>

            <FormField label="備註">
              <textarea
                value={form.note}
                onChange={(event) =>
                  setForm(
                    (current) => ({
                      ...current,
                      note: event.target
                        .value,
                    })
                  )
                }
                rows={3}
                className="form-input resize-none"
                placeholder="例如：9/15 加入、優惠方案..."
              />
            </FormField>

            {modalMode === "edit" &&
              selectedDriver && (
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                  <p className="text-xs font-bold text-rose-700">
                    危險操作
                  </p>

                  <p className="mt-1 text-xs text-rose-500">
                    一般不跑車請使用休息或已退出，不建議永久刪除。
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      closeDriverModal();
                      void deleteDriver(
                        selectedDriver.id
                      );
                    }}
                    className="mt-3 text-xs font-bold text-rose-600 underline"
                  >
                    永久刪除這位司機
                  </button>
                </div>
              )}

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
              <button
                type="button"
                onClick={
                  closeDriverModal
                }
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold"
              >
                取消
              </button>

              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving
                  ? "儲存中..."
                  : modalMode ===
                    "create"
                  ? "新增司機"
                  : "儲存修改"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {sheetSyncOpen && (
        <Modal
          title={`從試算表同步｜${monthLabel(month)}`}
          onClose={() =>
            !saving &&
            !sheetLoading &&
            setSheetSyncOpen(false)
          }
        >
          <div className="space-y-5">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-sm font-bold text-blue-700">
                📊 司機月費繳費試算表
              </p>
              <p className="mt-1 text-xs leading-5 text-blue-600/80">
                系統會依目前選擇的月份，自動讀取對應的「X月司機繳費」工作表。
                不需要再複製貼上司機名單。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <AmountBox
                label="目前月份"
                value={monthLabel(month)}
              />
              <AmountBox
                label="來源工作表"
                value={sheetName || (sheetLoading ? "讀取中..." : "—")}
              />
              <AmountBox
                label="可同步司機"
                value={`${sheetDrivers.length} 位`}
              />
            </div>

            {availableSheetMonths.length > 0 && (
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-500">
                  試算表目前可用月份
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {availableSheetMonths.map((item) => (
                    <span
                      key={item.month}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                        item.month === Number(month.split("-")[1])
                          ? "bg-blue-600 text-white"
                          : "bg-white text-slate-600"
                      }`}
                    >
                      {item.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {sheetError && !sheetLoading && (
              <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-semibold leading-5 text-rose-700">
                ⚠️ {sheetError}
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-sm font-bold text-slate-700">
                  同步預覽
                </p>
                <button
                  type="button"
                  disabled={sheetLoading || saving}
                  onClick={() => void loadSheetPreview()}
                  className="text-xs font-bold text-blue-600 disabled:opacity-50"
                >
                  ↻ 重新讀取
                </button>
              </div>

              <div className="max-h-[320px] overflow-auto">
                {sheetLoading ? (
                  <div className="px-5 py-12 text-center text-sm text-slate-400">
                    正在讀取 Google 試算表...
                  </div>
                ) : sheetDrivers.length === 0 ? (
                  <div className="px-5 py-12 text-center">
                    <div className="text-3xl">📭</div>
                    <p className="mt-2 text-sm font-bold text-slate-600">
                      這個月份沒有可同步資料
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      請確認試算表是否已有對應月份工作表。
                    </p>
                  </div>
                ) : (
                  <table className="w-full min-w-[620px]">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-100 text-left text-xs font-bold text-slate-400">
                        <th className="px-4 py-3">司機</th>
                        <th className="px-4 py-3">車牌</th>
                        <th className="px-4 py-3 text-right">入會費</th>
                        <th className="px-4 py-3 text-right">月費</th>
                        <th className="px-4 py-3">備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheetDrivers.map((driver, index) => (
                        <tr
                          key={`${driver.sourceRow ?? index}-${driver.name}-${driver.plate}`}
                          className="border-b border-slate-100 text-sm last:border-b-0"
                        >
                          <td className="px-4 py-3 font-bold">
                            {driver.name}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {driver.plate || "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {money(Number(driver.joinFee || 0))}
                          </td>
                          <td className="px-4 py-3 text-right font-bold">
                            {money(Number(driver.monthlyFee || 0))}
                          </td>
                          <td className="max-w-[180px] px-4 py-3 text-xs text-slate-500">
                            {driver.note || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
              <p className="text-xs font-bold text-amber-700">
                同步規則
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-700/80">
                新司機會送到既有的 /api/drivers/import 建立主檔；
                已存在的重複司機會依目前匯入 API 規則跳過，不會重複建立。
                本功能不會刪除 Firebase 既有司機。
              </p>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
              <button
                type="button"
                disabled={saving || sheetLoading}
                onClick={() => setSheetSyncOpen(false)}
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold disabled:opacity-50"
              >
                取消
              </button>

              <button
                type="button"
                disabled={saving || sheetLoading || sheetDrivers.length === 0}
                onClick={() => void syncFromSheet()}
                className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? "同步中..."
                  : `確認同步 ${sheetDrivers.length} 位`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {paymentRecord && (
        <Modal
          title={`${paymentRecord.driverName}｜${monthLabel(
            month
          )}繳費`}
          onClose={() =>
            !saving &&
            setPaymentRecord(null)
          }
        >
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <AmountBox
                label="月費"
                value={money(
                  paymentRecord.monthlyFee
                )}
              />

              <AmountBox
                label="入會費"
                value={money(
                  paymentRecord.joinFee
                )}
              />

              <AmountBox
                label="應繳"
                value={money(
                  paymentRecord.totalAmount
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="月費已繳金額">
                <input
                  type="number"
                  min="0"
                  max={paymentRecord.monthlyFee}
                  value={monthlyFeePaymentAmount}
                  onChange={(event) => setMonthlyFeePaymentAmount(event.target.value)}
                  className="form-input"
                />
              </FormField>

              <FormField label="入會費已繳金額">
                <input
                  type="number"
                  min="0"
                  max={paymentRecord.joinFee}
                  value={joinFeePaymentAmount}
                  onChange={(event) => setJoinFeePaymentAmount(event.target.value)}
                  className="form-input"
                  disabled={paymentRecord.joinFee <= 0}
                />
              </FormField>

              <FormField label="繳費日期">
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                  className="form-input"
                />
              </FormField>
            </div>

            <FormField label="繳費方式">
              <select
                value={paymentMethod}
                onChange={(event) =>
                  setPaymentMethod(
                    event.target.value
                  )
                }
                className="form-input"
              >
                <option value="街口">
                  街口
                </option>
                <option value="轉帳">
                  銀行轉帳
                </option>
                <option value="現金">
                  現金
                </option>
                <option value="LINE Pay">
                  LINE Pay
                </option>
                <option value="其他">
                  其他
                </option>
              </select>
            </FormField>

            <FormField label="本月備註">
              <textarea
                value={paymentNote}
                onChange={(event) =>
                  setPaymentNote(
                    event.target.value
                  )
                }
                rows={3}
                className="form-input resize-none"
                placeholder="例如：9/15 已轉帳"
              />
            </FormField>

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
              {paymentRecord.paid && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void savePayment(
                      false
                    )
                  }
                  className="rounded-xl bg-rose-50 px-5 py-2.5 text-sm font-bold text-rose-600"
                >
                  改為未繳
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  setPaymentRecord(
                    null
                  )
                }
                className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold"
              >
                取消
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void savePayment(true)
                }
                className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving
                  ? "儲存中..."
                  : paymentRecord.paid
                  ? "更新繳費資料"
                  : Number(monthlyFeePaymentAmount || 0) >= paymentRecord.monthlyFee &&
                    Number(joinFeePaymentAmount || 0) >= paymentRecord.joinFee
                  ? "確認已繳清"
                  : "儲存部分繳費"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <style jsx global>{`
        .form-input {
          width: 100%;
          border: 1px solid rgb(226 232 240);
          border-radius: 0.75rem;
          background: rgb(248 250 252);
          padding: 0.75rem 0.875rem;
          font-size: 0.875rem;
          outline: none;
          transition: 0.2s;
        }

        .form-input:focus {
          border-color: rgb(96 165 250);
          background: white;
          box-shadow: 0 0 0 3px
            rgba(59, 130, 246, 0.08);
        }
      `}</style>
    </div>
  );
}

function SideLink({
  href,
  icon,
  label,
  active = false,
}: {
  href: string;
  icon: string;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition ${
        active
          ? "bg-blue-500 font-semibold text-white shadow-lg shadow-blue-950/20"
          : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      <span>{icon}</span>
      {label}
    </Link>
  );
}

function SummaryCard({
  label,
  value,
  description,
  accent = "slate",
}: {
  label: string;
  value: string;
  description: string;
  accent?:
    | "slate"
    | "emerald"
    | "rose"
    | "blue";
}) {
  const accentClass = {
    slate: "text-slate-900",
    emerald: "text-emerald-600",
    rose: "text-rose-600",
    blue: "text-blue-600",
  }[accent];

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold text-slate-500">
        {label}
      </p>

      <p
        className={`mt-3 text-3xl font-black tracking-tight ${accentClass}`}
      >
        {value}
      </p>

      <div className="my-4 h-px bg-slate-100" />

      <p className="text-xs text-slate-400">
        {description}
      </p>
    </article>
  );
}

function StatusCard({
  icon,
  label,
  value,
  onClick,
}: {
  icon: string;
  label: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div>
        <p className="text-xs font-semibold text-slate-400">
          {label}
        </p>
        <p className="mt-1 text-2xl font-black">
          {value} 位
        </p>
      </div>

      <div className="text-2xl">
        {icon}
      </div>
    </button>
  );
}

function DriverStatusBadge({
  status,
}: {
  status: DriverStatus;
}) {
  const classes = {
    active:
      "bg-emerald-50 text-emerald-700",
    resting:
      "bg-amber-50 text-amber-700",
    inactive:
      "bg-slate-100 text-slate-500",
  }[status];

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1.5 text-xs font-bold ${classes}`}
    >
      {statusLabel(status)}
    </span>
  );
}

function PaymentBadge({
  paid,
  paidAmount,
  totalAmount,
  status,
}: {
  paid: boolean;
  paidAmount: number;
  totalAmount: number;
  status: DriverStatus;
}) {
  if (status === "inactive") {
    return (
      <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
        不計費
      </span>
    );
  }

  if (paid) {
    return (
      <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
        ● 已繳
      </span>
    );
  }

  if (paidAmount > 0 && paidAmount < totalAmount) {
    return (
      <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
        ● 部分繳
      </span>
    );
  }

  return (
    <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600">
      ● 未繳
    </span>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-5">
          <h3 className="text-xl font-black">
            {title}
          </h3>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-lg font-bold text-slate-500 hover:bg-slate-200"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold text-slate-500">
        {label}
      </span>

      {children}
    </label>
  );
}

function AmountBox({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-semibold text-slate-400">
        {label}
      </p>

      <p className="mt-1 text-lg font-black">
        {value}
      </p>
    </div>
  );
}