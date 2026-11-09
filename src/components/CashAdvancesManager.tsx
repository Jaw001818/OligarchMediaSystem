import { getBusinessDate } from "../utils";
import React, { useState, useMemo } from 'react';
import { db, addDoc, collection, doc, deleteDoc, updateDoc, query, where, getDocs, getLocalData, setLocalData } from '../firebase';
import { CashAdvance, BossDebt, Employee, PayrollPeriod, DeductionMethod, BossDebtPayoutMethod } from '../types';
import { 
  Plus, 
  Search, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Banknote, 
  Edit, 
  History, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Wallet, 
  Coins, 
  FileText, 
  Calendar,
  Sparkles,
  Info,
  CheckSquare,
  Square,
  AlertTriangle,
  Loader2,
  X,
  Check,
  Eye,
  EyeOff
} from 'lucide-react';

interface Props {
  advances: CashAdvance[];
  employees: Employee[];
  periods: PayrollPeriod[];
  bossDebts?: BossDebt[];
  onRefresh?: () => void;
}

export function CashAdvancesManager({ advances, employees, periods, bossDebts = [], onRefresh }: Props) {
  const [activeTab, setActiveTab] = useState<"advances" | "boss_debts">("boss_debts");
  const [searchTerm, setSearchTerm] = useState("");
  
  // Custom in-app deletion modal states (NO window.confirm / window.alert)
  const [confirmDeleteDebt, setConfirmDeleteDebt] = useState<BossDebt | null>(null);
  const [confirmDeleteAdvance, setConfirmDeleteAdvance] = useState<CashAdvance | null>(null);
  const [selectedDebtIds, setSelectedDebtIds] = useState<string[]>([]);
  const [selectedAdvanceIds, setSelectedAdvanceIds] = useState<string[]>([]);
  const [isConfirmBatchDeleteOpen, setIsConfirmBatchDeleteOpen] = useState(false);
  const [batchDeleteType, setBatchDeleteType] = useState<"boss_debts" | "advances">("boss_debts");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Advance Form & Modal States
  const [isAddingAdvance, setIsAddingAdvance] = useState(false);
  const [editingAdvanceId, setEditingAdvanceId] = useState<string | null>(null);
  const [advEmployeeId, setAdvEmployeeId] = useState("");
  const [advAmount, setAdvAmount] = useState(0);
  const [advDate, setAdvDate] = useState(getBusinessDate());
  const [advNotes, setAdvNotes] = useState("");
  const [advDeductionMethod, setAdvDeductionMethod] = useState<DeductionMethod>("Full");
  const [advSplitCount, setAdvSplitCount] = useState(1);
  const [advIsDeferred, setAdvIsDeferred] = useState(false);
  const [advDeferReason, setAdvDeferReason] = useState("");
  const [viewingAdvanceHistory, setViewingAdvanceHistory] = useState<CashAdvance | null>(null);
  const [manualDeductAdvance, setManualDeductAdvance] = useState<CashAdvance | null>(null);
  const [manualDeductAmount, setManualDeductAmount] = useState(0);

  // Boss Debt (Additional Cash / Boss Utang to Employee) Form & Modal States
  const [isAddingDebt, setIsAddingDebt] = useState(false);
  const [editingDebtId, setEditingDebtId] = useState<string | null>(null);
  const [debtEmployeeId, setDebtEmployeeId] = useState("");
  const [debtAmount, setDebtAmount] = useState(0);
  const [debtDate, setDebtDate] = useState(getBusinessDate());
  const [debtNotes, setDebtNotes] = useState("");
  const [debtPayoutMethod, setDebtPayoutMethod] = useState<BossDebtPayoutMethod>("Full");
  const [debtSplitCount, setDebtSplitCount] = useState(1);
  const [debtIsDeferred, setDebtIsDeferred] = useState(false);
  const [debtDeferReason, setDebtDeferReason] = useState("");
  const [viewingDebtHistory, setViewingDebtHistory] = useState<BossDebt | null>(null);
  const [manualPayoutDebt, setManualPayoutDebt] = useState<BossDebt | null>(null);
  const [manualPayoutAmount, setManualPayoutAmount] = useState(0);
  const [manualPayoutNote, setManualPayoutNote] = useState("");

  // Filtered Cash Advances
  const filteredAdvances = useMemo(() => {
    let list = advances;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(a => 
        a.employeeName.toLowerCase().includes(term) || 
        a.referenceId.toLowerCase().includes(term) ||
        (a.notes || "").toLowerCase().includes(term)
      );
    }
    return [...list].sort((a, b) => new Date(b.dateGranted).getTime() - new Date(a.dateGranted).getTime());
  }, [advances, searchTerm]);

  // Filtered Boss Debts (Additional Cash credits)
  const filteredBossDebts = useMemo(() => {
    let list = bossDebts;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(d => 
        d.employeeName.toLowerCase().includes(term) || 
        d.referenceId.toLowerCase().includes(term) ||
        (d.notes || "").toLowerCase().includes(term)
      );
    }
    return [...list].sort((a, b) => new Date(b.dateGranted).getTime() - new Date(a.dateGranted).getTime());
  }, [bossDebts, searchTerm]);

  // Totals for Boss Debts
  const totalBossDebtsCommitted = useMemo(() => bossDebts.reduce((sum, d) => sum + (d.amount || 0), 0), [bossDebts]);
  const totalBossDebtsRemaining = useMemo(() => bossDebts.filter(d => d.status !== "Cancelled").reduce((sum, d) => sum + (d.remainingBalance || 0), 0), [bossDebts]);
  const totalBossDebtsDisbursed = totalBossDebtsCommitted - totalBossDebtsRemaining;

  // Totals for Cash Advances
  const totalAdvancesGiven = useMemo(() => advances.reduce((sum, a) => sum + (a.amount || 0), 0), [advances]);
  const totalAdvancesRemaining = useMemo(() => advances.filter(a => a.status !== "Cancelled").reduce((sum, a) => sum + (a.remainingBalance || 0), 0), [advances]);
  const totalAdvancesCollected = totalAdvancesGiven - totalAdvancesRemaining;

  // Reset forms
  const resetAdvanceForm = () => {
    setIsAddingAdvance(false);
    setEditingAdvanceId(null);
    setAdvEmployeeId("");
    setAdvAmount(0);
    setAdvNotes("");
    setAdvDeductionMethod("Full");
    setAdvSplitCount(1);
    setAdvIsDeferred(false);
    setAdvDeferReason("");
    setAdvDate(getBusinessDate());
  };

  const resetDebtForm = () => {
    setIsAddingDebt(false);
    setEditingDebtId(null);
    setDebtEmployeeId("");
    setDebtAmount(0);
    setDebtNotes("");
    setDebtPayoutMethod("Full");
    setDebtSplitCount(1);
    setDebtIsDeferred(false);
    setDebtDeferReason("");
    setDebtDate(getBusinessDate());
  };

  // Cash Advance Handlers
  const handleEditAdvance = (adv: CashAdvance) => {
    setEditingAdvanceId(adv.id || null);
    setAdvEmployeeId(adv.employeeId);
    setAdvAmount(adv.amount);
    setAdvDate(adv.dateGranted);
    setAdvNotes(adv.notes);
    setAdvDeductionMethod(adv.deductionMethod);
    setAdvSplitCount(adv.splitCount || 1);
    setAdvIsDeferred(Boolean(adv.isDeferred));
    setAdvDeferReason(adv.deferReason || "");
    setIsAddingAdvance(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleAdvanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advEmployeeId || advAmount <= 0) return;
    const emp = employees.find(e => e.id === advEmployeeId);
    if (!emp) return;

    try {
      if (editingAdvanceId) {
        const existing = advances.find(a => a.id === editingAdvanceId);
        if (!existing) return;
        const diff = advAmount - existing.amount;
        let newRemaining = existing.remainingBalance + diff;
        if (newRemaining < 0) newRemaining = 0;

        await updateDoc(doc(db, "cash_advances", editingAdvanceId), {
          amount: advAmount,
          remainingBalance: newRemaining,
          dateGranted: advDate,
          deductionMethod: advDeductionMethod,
          splitCount: advDeductionMethod === "Split" ? advSplitCount : null,
          notes: advNotes,
          isDeferred: advIsDeferred,
          deferReason: advDeferReason,
          status: newRemaining <= 0 ? "Fully Paid" : existing.status
        });
      } else {
        const refId = `CA-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const newRecord: Omit<CashAdvance, 'id'> = {
          referenceId: refId,
          employeeId: emp.id!,
          employeeName: emp.fullName,
          amount: advAmount,
          remainingBalance: advAmount,
          dateGranted: advDate,
          status: "Pending",
          deductionMethod: advDeductionMethod,
          splitCount: advDeductionMethod === "Split" ? advSplitCount : null,
          notes: advNotes,
          history: [],
          isDeferred: advIsDeferred,
          deferReason: advDeferReason
        };
        await addDoc(collection(db, "cash_advances"), newRecord);
      }
      resetAdvanceForm();
    } catch (err) {
      console.error(err);
      alert("Error saving cash advance record.");
    }
  };

  const handleToggleAdvanceDeferred = async (adv: CashAdvance) => {
    const advId = adv.id;
    if (!advId) return;
    try {
      await updateDoc(doc(db, "cash_advances", advId), {
        isDeferred: !adv.isDeferred,
        deferReason: !adv.isDeferred ? "Employee requested deduction in next cutoff" : ""
      });
      setSuccessBanner(!adv.isDeferred ? "Deduction hidden from current cutoff (Deferred to next cutoff)." : "Deduction restored to current cutoff payslip.");
      setTimeout(() => setSuccessBanner(null), 3500);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Error toggling advance deferral:", err);
    }
  };

  const executeDeleteAdvance = async (adv: CashAdvance) => {
    setIsDeleting(true);
    setDeleteErrorMessage(null);
    try {
      // 0. Backup to deleted_records (Recycle Bin) before deletion
      try {
        await addDoc(collection(db, "deleted_records"), {
          recordType: "Cash Advance",
          originalCollection: "cash_advances",
          originalId: adv.id || adv.referenceId,
          data: adv,
          deletedAt: new Date().toISOString(),
          deletedBy: "Admin"
        });
      } catch (rbErr) {
        console.warn("Could not save to deleted_records:", rbErr);
      }

      // 1. Direct doc deletion if id is present
      if (adv.id) {
        try {
          await deleteDoc(doc(db, "cash_advances", adv.id));
        } catch (err: any) {
          console.warn("Direct doc delete error, trying query fallback:", err);
        }
      }
      // 2. Query fallback by referenceId to ensure removal
      if (adv.referenceId) {
        try {
          const q = query(collection(db, "cash_advances"), where("referenceId", "==", adv.referenceId));
          const snaps = await getDocs(q);
          if (snaps && snaps.docs) {
            for (const snap of snaps.docs) {
              await deleteDoc(doc(db, "cash_advances", snap.id));
            }
          }
        } catch (qErr: any) {
          console.warn("Query fallback delete error:", qErr);
        }
      }
      // 3. Clean local storage sandbox cache if present
      try {
        const local = getLocalData("cash_advances");
        if (Array.isArray(local) && local.length > 0) {
          const filtered = local.filter((a: any) => a.id !== adv.id && a.referenceId !== adv.referenceId);
          setLocalData("cash_advances", filtered);
        }
      } catch (lsErr) {
        console.warn("Local storage clean error:", lsErr);
      }
      // 4. Trigger refresh
      if (onRefresh) onRefresh();
      setSelectedAdvanceIds(prev => prev.filter(id => id !== adv.id && id !== adv.referenceId));
      setConfirmDeleteAdvance(null);
      setSuccessBanner(`Deleted cash advance ${adv.referenceId} (${adv.employeeName}) - stored in Recycle Bin.`);
      setTimeout(() => setSuccessBanner(null), 4000);
    } catch (err: any) {
      console.error("Delete advance error:", err);
      setDeleteErrorMessage(err?.message || "Failed to delete cash advance. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleManualDeductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDeductAdvance || !manualDeductAdvance.id || manualDeductAmount <= 0) return;
    const adv = manualDeductAdvance;
    if (manualDeductAmount > adv.remainingBalance) {
      alert("Deduction amount cannot exceed remaining balance.");
      return;
    }

    try {
      const newRemaining = adv.remainingBalance - manualDeductAmount;
      const newHistory = [...(adv.history || []), {
        date: new Date().toISOString(),
        amount: manualDeductAmount,
        periodId: "Manual Deduction"
      }];

      await updateDoc(doc(db, "cash_advances", adv.id), {
        remainingBalance: newRemaining,
        history: newHistory,
        status: newRemaining <= 0 ? "Fully Paid" : "Active"
      });

      setManualDeductAdvance(null);
      setManualDeductAmount(0);
    } catch (err) {
      console.error(err);
      alert("Error processing manual deduction.");
    }
  };

  // Boss Debt (Additional Cash) Handlers
  const handleEditDebt = (debt: BossDebt) => {
    setEditingDebtId(debt.id || null);
    setDebtEmployeeId(debt.employeeId);
    setDebtAmount(debt.amount);
    setDebtDate(debt.dateGranted);
    setDebtNotes(debt.notes);
    setDebtPayoutMethod(debt.payoutMethod);
    setDebtSplitCount(debt.splitCount || 1);
    setDebtIsDeferred(Boolean(debt.isDeferred));
    setDebtDeferReason(debt.deferReason || "");
    setIsAddingDebt(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDebtSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!debtEmployeeId || debtAmount <= 0) return;
    const emp = employees.find(e => e.id === debtEmployeeId);
    if (!emp) return;

    try {
      if (editingDebtId) {
        const existing = bossDebts.find(d => d.id === editingDebtId);
        if (!existing) return;
        const diff = debtAmount - existing.amount;
        let newRemaining = existing.remainingBalance + diff;
        if (newRemaining < 0) newRemaining = 0;

        await updateDoc(doc(db, "boss_debts", editingDebtId), {
          amount: debtAmount,
          remainingBalance: newRemaining,
          dateGranted: debtDate,
          payoutMethod: debtPayoutMethod,
          splitCount: debtPayoutMethod === "Split" ? debtSplitCount : null,
          notes: debtNotes,
          isDeferred: debtIsDeferred,
          deferReason: debtDeferReason,
          status: newRemaining <= 0 ? "Fully Paid" : existing.status
        });
      } else {
        const refId = `BC-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const newRecord: Omit<BossDebt, 'id'> = {
          referenceId: refId,
          employeeId: emp.id!,
          employeeName: emp.fullName,
          amount: debtAmount,
          remainingBalance: debtAmount,
          dateGranted: debtDate,
          status: "Pending",
          payoutMethod: debtPayoutMethod,
          splitCount: debtPayoutMethod === "Split" ? debtSplitCount : null,
          notes: debtNotes,
          history: [],
          isDeferred: debtIsDeferred,
          deferReason: debtDeferReason
        };
        await addDoc(collection(db, "boss_debts"), newRecord);
      }
      resetDebtForm();
    } catch (err) {
      console.error(err);
      alert("Error saving additional cash / boss debt record.");
    }
  };

  const handleToggleDebtDeferred = async (debt: BossDebt) => {
    const debtId = debt.id;
    if (!debtId) return;
    try {
      await updateDoc(doc(db, "boss_debts", debtId), {
        isDeferred: !debt.isDeferred,
        deferReason: !debt.isDeferred ? "Deferred to next cutoff" : ""
      });
      setSuccessBanner(!debt.isDeferred ? "Boss Plus hidden from current cutoff (Deferred to next cutoff)." : "Boss Plus restored to current cutoff payslip.");
      setTimeout(() => setSuccessBanner(null), 3500);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error("Error toggling debt deferral:", err);
    }
  };

  // Identified 13th month debts for quick 1-click batch cleanup
  const thirteenthMonthDebts = useMemo(() => {
    return bossDebts.filter(d => 
      (d.notes && d.notes.toLowerCase().includes("13th")) || 
      (d.referenceId && d.referenceId.toLowerCase().includes("13th"))
    );
  }, [bossDebts]);

  const toggleSelectDebt = (debt: BossDebt) => {
    const key = debt.id || debt.referenceId;
    setSelectedDebtIds(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const toggleSelectAllDebts = () => {
    if (selectedDebtIds.length === filteredBossDebts.length) {
      setSelectedDebtIds([]);
    } else {
      setSelectedDebtIds(filteredBossDebts.map(d => d.id || d.referenceId));
    }
  };

  const toggleSelectAdvance = (adv: CashAdvance) => {
    const key = adv.id || adv.referenceId;
    setSelectedAdvanceIds(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const toggleSelectAllAdvances = () => {
    if (selectedAdvanceIds.length === filteredAdvances.length) {
      setSelectedAdvanceIds([]);
    } else {
      setSelectedAdvanceIds(filteredAdvances.map(a => a.id || a.referenceId));
    }
  };

  const handleOpenBatchDelete = (type: "boss_debts" | "advances") => {
    setBatchDeleteType(type);
    setDeleteErrorMessage(null);
    setIsConfirmBatchDeleteOpen(true);
  };

  const handleSelectAll13thMonthDebts = () => {
    const keys = thirteenthMonthDebts.map(d => d.id || d.referenceId);
    setSelectedDebtIds(keys);
    setBatchDeleteType("boss_debts");
    setDeleteErrorMessage(null);
    setIsConfirmBatchDeleteOpen(true);
  };

  const executeDeleteDebt = async (debt: BossDebt) => {
    setIsDeleting(true);
    setDeleteErrorMessage(null);
    try {
      // 0. Backup to deleted_records (Recycle Bin) before deletion
      try {
        await addDoc(collection(db, "deleted_records"), {
          recordType: "Boss Debt / Boss Plus",
          originalCollection: "boss_debts",
          originalId: debt.id || debt.referenceId,
          data: debt,
          deletedAt: new Date().toISOString(),
          deletedBy: "Admin"
        });
      } catch (rbErr) {
        console.warn("Could not save to deleted_records:", rbErr);
      }

      // 1. Direct Firestore doc delete
      if (debt.id) {
        try {
          await deleteDoc(doc(db, "boss_debts", debt.id));
        } catch (err: any) {
          console.warn("Direct doc delete error, trying query fallback:", err);
        }
      }
      // 2. Query fallback by referenceId to ensure removal
      if (debt.referenceId) {
        try {
          const q = query(collection(db, "boss_debts"), where("referenceId", "==", debt.referenceId));
          const snaps = await getDocs(q);
          if (snaps && snaps.docs) {
            for (const snap of snaps.docs) {
              await deleteDoc(doc(db, "boss_debts", snap.id));
            }
          }
        } catch (qErr: any) {
          console.warn("Query fallback delete error:", qErr);
        }
      }
      // 3. Clean up local storage sandbox cache if present
      try {
        const local = getLocalData("boss_debts");
        if (Array.isArray(local) && local.length > 0) {
          const filtered = local.filter((d: any) => d.id !== debt.id && d.referenceId !== debt.referenceId);
          setLocalData("boss_debts", filtered);
        }
      } catch (lsErr) {
        console.warn("Local storage clean error:", lsErr);
      }
      // 4. Trigger refresh
      if (onRefresh) onRefresh();
      setSelectedDebtIds(prev => prev.filter(id => id !== debt.id && id !== debt.referenceId));
      setConfirmDeleteDebt(null);
      setSuccessBanner(`Deleted credit ${debt.referenceId} (${debt.employeeName}) - stored in Recycle Bin.`);
      setTimeout(() => setSuccessBanner(null), 4000);
    } catch (err: any) {
      console.error("Delete debt error:", err);
      setDeleteErrorMessage(err?.message || "Failed to delete record. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  };

  const executeBatchDelete = async () => {
    setIsDeleting(true);
    setDeleteErrorMessage(null);
    try {
      if (batchDeleteType === "boss_debts") {
        const toDelete = bossDebts.filter(d => 
          (d.id && selectedDebtIds.includes(d.id)) || 
          (d.referenceId && selectedDebtIds.includes(d.referenceId))
        );
        for (const debt of toDelete) {
          if (debt.id) {
            try {
              await deleteDoc(doc(db, "boss_debts", debt.id));
            } catch (e) {
              console.warn("Batch doc delete warning:", e);
            }
          }
          if (debt.referenceId) {
            try {
              const q = query(collection(db, "boss_debts"), where("referenceId", "==", debt.referenceId));
              const snaps = await getDocs(q);
              if (snaps && snaps.docs) {
                for (const s of snaps.docs) {
                  await deleteDoc(doc(db, "boss_debts", s.id));
                }
              }
            } catch (e) {
              console.warn("Batch query fallback warning:", e);
            }
          }
        }
        try {
          const local = getLocalData("boss_debts");
          if (Array.isArray(local) && local.length > 0) {
            const filtered = local.filter((d: any) => 
              !selectedDebtIds.includes(d.id) && !selectedDebtIds.includes(d.referenceId)
            );
            setLocalData("boss_debts", filtered);
          }
        } catch (e) {}

        if (onRefresh) onRefresh();
        const count = toDelete.length;
        setSelectedDebtIds([]);
        setIsConfirmBatchDeleteOpen(false);
        setSuccessBanner(`Successfully deleted ${count} boss cash credit records.`);
        setTimeout(() => setSuccessBanner(null), 4000);
      } else {
        const toDelete = advances.filter(a => 
          (a.id && selectedAdvanceIds.includes(a.id)) || 
          (a.referenceId && selectedAdvanceIds.includes(a.referenceId))
        );
        for (const adv of toDelete) {
          if (adv.id) {
            try {
              await deleteDoc(doc(db, "cash_advances", adv.id));
            } catch (e) {}
          }
          if (adv.referenceId) {
            try {
              const q = query(collection(db, "cash_advances"), where("referenceId", "==", adv.referenceId));
              const snaps = await getDocs(q);
              if (snaps && snaps.docs) {
                for (const s of snaps.docs) {
                  await deleteDoc(doc(db, "cash_advances", s.id));
                }
              }
            } catch (e) {}
          }
        }
        try {
          const local = getLocalData("cash_advances");
          if (Array.isArray(local) && local.length > 0) {
            const filtered = local.filter((a: any) => 
              !selectedAdvanceIds.includes(a.id) && !selectedAdvanceIds.includes(a.referenceId)
            );
            setLocalData("cash_advances", filtered);
          }
        } catch (e) {}

        if (onRefresh) onRefresh();
        const count = toDelete.length;
        setSelectedAdvanceIds([]);
        setIsConfirmBatchDeleteOpen(false);
        setSuccessBanner(`Successfully deleted ${count} cash advance records.`);
        setTimeout(() => setSuccessBanner(null), 4000);
      }
    } catch (err: any) {
      console.error("Batch delete error:", err);
      setDeleteErrorMessage(err?.message || "Failed to complete batch deletion.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleManualPayoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualPayoutDebt || !manualPayoutDebt.id || manualPayoutAmount <= 0) return;
    const debt = manualPayoutDebt;
    if (manualPayoutAmount > debt.remainingBalance) {
      alert("Payout amount cannot exceed remaining balance.");
      return;
    }

    try {
      const newRemaining = debt.remainingBalance - manualPayoutAmount;
      const newHistory = [...(debt.history || []), {
        date: new Date().toISOString(),
        amount: manualPayoutAmount,
        periodId: "Manual Cash Handover",
        note: manualPayoutNote || "Boss paid cash in hand directly outside payroll"
      }];

      await updateDoc(doc(db, "boss_debts", debt.id), {
        remainingBalance: newRemaining,
        history: newHistory,
        status: newRemaining <= 0 ? "Fully Paid" : "Active"
      });

      setManualPayoutDebt(null);
      setManualPayoutAmount(0);
      setManualPayoutNote("");
    } catch (err) {
      console.error(err);
      alert("Error recording manual payout.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-black text-zinc-900 dark:text-zinc-50 tracking-tight flex items-center gap-2.5">
            <Coins className="text-emerald-500 w-6 h-6" />
            Advances & Boss Cash Credits
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Manage employee cash advance deductions (-) and additional cash additions (+) where the boss pays back loans or owes money to employees.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-zinc-100 dark:bg-zinc-800/80 p-1 rounded-xl border border-zinc-200/80 dark:border-zinc-700/80">
          <button
            onClick={() => { setActiveTab("boss_debts"); resetDebtForm(); }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "boss_debts"
                ? "bg-emerald-600 text-white shadow-xs"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            <ArrowUpRight size={14} className="text-emerald-300" />
            <span>Additional Cash / Boss Debt (+)</span>
            {bossDebts.filter(d => d.status !== "Fully Paid" && d.status !== "Cancelled").length > 0 && (
              <span className="bg-emerald-500 text-white text-[10px] px-1.5 py-0.2 rounded-full">
                {bossDebts.filter(d => d.status !== "Fully Paid" && d.status !== "Cancelled").length}
              </span>
            )}
          </button>

          <button
            onClick={() => { setActiveTab("advances"); resetAdvanceForm(); }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "advances"
                ? "bg-rose-600 text-white shadow-xs"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            <ArrowDownLeft size={14} className="text-rose-300" />
            <span>Cash Advances / Deductions (-)</span>
            {advances.filter(a => a.status !== "Fully Paid" && a.status !== "Cancelled").length > 0 && (
              <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.2 rounded-full">
                {advances.filter(a => a.status !== "Fully Paid" && a.status !== "Cancelled").length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* SECTION 1: BOSS DEBTS / ADDITIONAL CASH ADDITIONS (+) */}
      {/* ========================================================= */}
      {activeTab === "boss_debts" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Informational Callout */}
          <div className="p-4 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-transparent border border-emerald-500/20 rounded-2xl flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl mt-0.5">
                <Sparkles size={18} />
              </div>
              <div>
                <h4 className="text-sm font-black text-emerald-900 dark:text-emerald-300">
                  Boss Debt Repayment & Additional Cash Feature (Added to Payslip +)
                </h4>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed max-w-3xl">
                  When the boss owes money ("utang") to an employee (e.g. personal loan from employee, travel/gas reimbursement, equipment purchased with staff personal funds, or special cash bonus), record it here. The specified amount will automatically be <strong>ADDED as a positive (+) cash payout</strong> to the employee’s next payslip or split across cutoffs!
                </p>
              </div>
            </div>
            <button
              onClick={() => { resetDebtForm(); setIsAddingDebt(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <Plus size={15} />
              <span>Record Boss Debt / Cash Addition</span>
            </button>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">TOTAL CASH COMMITTED / UTANG</span>
              <span className="text-lg font-black text-zinc-900 dark:text-zinc-100 font-mono mt-1 block">
                ₱{(totalBossDebtsCommitted || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-emerald-200/50 dark:border-emerald-900/30 p-4 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">REMAINING BALANCE TO PAYOUT</span>
              <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono mt-1 block">
                ₱{(totalBossDebtsRemaining || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">TOTAL DISBURSED TO EMPLOYEES</span>
              <span className="text-lg font-black text-teal-600 dark:text-teal-400 font-mono mt-1 block">
                ₱{(totalBossDebtsDisbursed || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Add / Edit Boss Debt Form */}
          {isAddingDebt && (
            <form onSubmit={handleDebtSubmit} className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border-2 border-emerald-500/30 dark:border-emerald-500/20 space-y-4 shadow-xl animate-in fade-in slide-in-from-top-4">
              <div className="flex items-center justify-between border-b border-zinc-150 dark:border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                  <h3 className="text-sm font-black text-zinc-900 dark:text-zinc-100">
                    {editingDebtId ? "Edit Additional Cash / Boss Debt" : "Record Additional Cash to Pay Employee (Boss Utang)"}
                  </h3>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md">
                  Payslip Addition (+)
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Select Employee (Payee)</label>
                  <select 
                    value={debtEmployeeId} 
                    onChange={(e) => setDebtEmployeeId(e.target.value)}
                    required
                    disabled={!!editingDebtId}
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">Select Employee</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>{e.fullName} ({e.employeeNumber})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Total Cash Amount (₱)</label>
                  <input 
                    type="number"
                    min="1"
                    step="0.01"
                    value={debtAmount || ""}
                    onChange={(e) => setDebtAmount(parseFloat(e.target.value) || 0)}
                    required
                    placeholder="e.g. 5000"
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono font-bold text-emerald-600 dark:text-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Date Incurred / Granted</label>
                  <input 
                    type="date"
                    value={debtDate}
                    onChange={(e) => setDebtDate(e.target.value)}
                    required
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Payout Method</label>
                  <select
                    value={debtPayoutMethod}
                    onChange={(e) => setDebtPayoutMethod(e.target.value as BossDebtPayoutMethod)}
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-medium"
                  >
                    <option value="Full">Full Payout (Add entire remaining balance to next payslip)</option>
                    <option value="Split">Split Across Cutoffs (Spread across multiple payslips)</option>
                    <option value="Manual">Manual Payout Only (Handover cash directly in person)</option>
                  </select>
                </div>

                {debtPayoutMethod === "Split" && (
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">
                      Number of Cutoff Splits ({debtSplitCount} cutoffs = ₱{(((debtAmount || 0) / (debtSplitCount || 1)) || 0).toFixed(2)} / cutoff)
                    </label>
                    <input 
                      type="number"
                      min="2"
                      max="24"
                      value={debtSplitCount}
                      onChange={(e) => setDebtSplitCount(parseInt(e.target.value) || 2)}
                      required
                      className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono"
                    />
                  </div>
                )}

                <div className={debtPayoutMethod === "Split" ? "md:col-span-1" : "md:col-span-2"}>
                  <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Reason / Note for Payslip (Utang Explanation)</label>
                  <input 
                    type="text"
                    value={debtNotes}
                    onChange={(e) => setDebtNotes(e.target.value)}
                    placeholder="e.g., Boss repayment of personal loan, reimbursement for office supplies, gas expense refund..."
                    required
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>

                <div className="md:col-span-2 p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-xl space-y-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={debtIsDeferred}
                      onChange={(e) => setDebtIsDeferred(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded text-emerald-600 border-zinc-300 dark:border-zinc-600 focus:ring-emerald-500 cursor-pointer"
                    />
                    <div className="flex-1 text-xs">
                      <div className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                        <EyeOff className="w-3.5 h-3.5 text-amber-500" />
                        <span>Hide from current payslip (Postpone / Defer to next cutoff)</span>
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Hold this addition and pay it out in the next payroll cutoff instead of this active payslip.
                      </div>
                    </div>
                  </label>
                  {debtIsDeferred && (
                    <input
                      type="text"
                      value={debtDeferReason}
                      onChange={(e) => setDebtDeferReason(e.target.value)}
                      placeholder="Reason for postponing (e.g. Scheduled for next cutoff)"
                      className="w-full text-xs px-3 py-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none text-zinc-900 dark:text-zinc-100 focus:border-emerald-500"
                    />
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-zinc-150 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={resetDebtForm}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-black shadow-sm transition-colors cursor-pointer flex items-center gap-2"
                >
                  <CheckCircle2 size={16} />
                  <span>{editingDebtId ? "Update Boss Debt Record" : "Save & Add to Payslips"}</span>
                </button>
              </div>
            </form>
          )}

          {/* Success Banner */}
          {successBanner && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Check size={16} />
                <span>{successBanner}</span>
              </div>
              <button onClick={() => setSuccessBanner(null)} className="text-emerald-600 hover:text-emerald-800">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Boss Debts Search & Table */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden shadow-xs flex flex-col min-h-[350px]">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={15} />
                <input 
                  type="text" 
                  placeholder="Search by employee, ref ID, or note..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 outline-none transition-all dark:text-zinc-100"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedDebtIds.length > 0 && (
                  <button
                    onClick={() => handleOpenBatchDelete("boss_debts")}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Delete Selected ({selectedDebtIds.length})</span>
                  </button>
                )}
                {thirteenthMonthDebts.length > 0 && (
                  <button
                    onClick={handleSelectAll13thMonthDebts}
                    className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Clean up all 13th month boss credit records"
                  >
                    <Trash2 size={13} />
                    <span>Delete All 13th Month ({thirteenthMonthDebts.length})</span>
                  </button>
                )}
                <div className="text-[11px] font-bold text-zinc-500">
                  Showing {filteredBossDebts.length} record{filteredBossDebts.length !== 1 ? "s" : ""}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 uppercase font-mono text-[10px] tracking-wider">
                  <tr>
                    <th className="w-10 px-4 py-3 text-center">
                      <button 
                        type="button" 
                        onClick={toggleSelectAllDebts} 
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                        title={selectedDebtIds.length === filteredBossDebts.length ? "Deselect All" : "Select All"}
                      >
                        {selectedDebtIds.length > 0 && selectedDebtIds.length === filteredBossDebts.length ? (
                          <CheckSquare size={15} className="text-emerald-500" />
                        ) : (
                          <Square size={15} />
                        )}
                      </button>
                    </th>
                    <th className="px-5 py-3 font-bold">Reference ID</th>
                    <th className="px-5 py-3 font-bold">Employee (Payee)</th>
                    <th className="px-5 py-3 font-bold">Total / Remaining Balance</th>
                    <th className="px-5 py-3 font-bold">Payout Method</th>
                    <th className="px-5 py-3 font-bold">Reason / Note</th>
                    <th className="px-5 py-3 font-bold">Status</th>
                    <th className="px-5 py-3 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150 dark:divide-zinc-800">
                  {filteredBossDebts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-zinc-400">
                        <Coins size={32} className="mx-auto mb-2 text-zinc-300 dark:text-zinc-600" />
                        <p className="text-sm font-medium">No additional cash / boss debt records found.</p>
                        <p className="text-xs text-zinc-400 mt-1">Click "Record Boss Debt / Cash Addition" to add extra cash to an employee's payslip.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredBossDebts.map(debt => {
                      const isSelected = selectedDebtIds.includes(debt.id || debt.referenceId);
                      return (
                        <tr key={debt.id || debt.referenceId} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors ${isSelected ? "bg-emerald-50/40 dark:bg-emerald-950/20" : ""}`}>
                          <td className="w-10 px-4 py-3.5 text-center">
                            <button
                              type="button"
                              onClick={() => toggleSelectDebt(debt)}
                              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare size={15} className="text-emerald-500" />
                              ) : (
                                <Square size={15} />
                              )}
                            </button>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                            {debt.referenceId}
                            <span className="block text-[9px] text-zinc-400 font-normal">{debt.dateGranted}</span>
                          </td>
                          <td className="px-5 py-3.5 font-bold text-zinc-900 dark:text-zinc-100">
                            {debt.employeeName}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex flex-col">
                              <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                                +₱{(debt.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                              <span className="text-[10px] text-zinc-400 font-mono">
                                Remaining: ₱{(debt.remainingBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-zinc-600 dark:text-zinc-300 font-medium">
                            {debt.payoutMethod === "Full" && (
                              <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-[10px] font-bold">
                                Full (Next Payslip)
                              </span>
                            )}
                            {debt.payoutMethod === "Split" && (
                              <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 text-[10px] font-bold">
                                Split ({debt.splitCount} cutoffs)
                              </span>
                            )}
                            {debt.payoutMethod === "Manual" && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-[10px] font-bold">
                                Manual Cash Handover
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-zinc-600 dark:text-zinc-300 max-w-xs truncate" title={debt.notes}>
                            {debt.notes || "—"}
                          </td>
                          <td className="px-5 py-3.5">
                            {debt.status === "Pending" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                <AlertCircle size={10} /> Pending
                              </span>
                            ) : debt.status === "Active" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                <Clock size={10} /> Active Payout
                              </span>
                            ) : debt.status === "Fully Paid" ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                                <CheckCircle2 size={10} /> Fully Paid
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                Cancelled
                              </span>
                            )}
                            {debt.isDeferred && (
                              <span className="block mt-1 text-[9px] font-bold text-amber-600 dark:text-amber-400 font-mono">
                                ↳ Hidden (Next Cutoff)
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex justify-end items-center gap-1">
                              {/* 1-Click Toggle Deferred / Active in Payslip */}
                              <button 
                                type="button"
                                onClick={() => handleToggleDebtDeferred(debt)}
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                  debt.isDeferred 
                                    ? "text-amber-600 hover:text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300" 
                                    : "text-zinc-400 hover:text-amber-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                }`}
                                title={debt.isDeferred ? "Currently Hidden from current payslip: Click to show/apply to current cutoff" : "Currently Active in payslip: Click to hide/defer to next cutoff"}
                              >
                                {debt.isDeferred ? <EyeOff size={15} /> : <Eye size={15} />}
                              </button>
                              <button 
                                onClick={() => setViewingDebtHistory(debt)}
                                className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                                title="View Payout History"
                              >
                                <History size={15} />
                              </button>
                              {debt.remainingBalance > 0 && debt.status !== "Cancelled" && (
                                <button 
                                  onClick={() => { setManualPayoutDebt(debt); setManualPayoutAmount(debt.remainingBalance); }}
                                  className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20 rounded-lg transition-colors cursor-pointer"
                                  title="Manual Cash Payout"
                                >
                                  <Banknote size={15} />
                                </button>
                              )}
                              <button 
                                onClick={() => handleEditDebt(debt)}
                                className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded-lg transition-colors cursor-pointer"
                                title="Edit Record"
                              >
                                <Edit size={15} />
                              </button>
                              <button 
                                onClick={() => {
                                  setDeleteErrorMessage(null);
                                  setConfirmDeleteDebt(debt);
                                }}
                                className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20 rounded-lg transition-colors cursor-pointer"
                                title="Delete Record"
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* SECTION 2: CASH ADVANCES / DEDUCTIONS (-) */}
      {/* ========================================================= */}
      {activeTab === "advances" && (
        <div className="space-y-6 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h3 className="text-sm font-black text-zinc-900 dark:text-zinc-100">
                Employee Cash Advances (Deducted from Payslip -)
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Manage loans or advances granted to employees that will be subtracted from their final payroll pay stub.
              </p>
            </div>
            <button
              onClick={() => { resetAdvanceForm(); setIsAddingAdvance(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-sm transition-colors cursor-pointer"
            >
              <Plus size={15} />
              <span>Record Cash Advance</span>
            </button>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">TOTAL ADVANCES GRANTED</span>
              <span className="text-lg font-black text-zinc-900 dark:text-zinc-100 font-mono mt-1 block">
                ₱{(totalAdvancesGiven || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-rose-200/50 dark:border-rose-900/30 p-4 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider block">REMAINING UNCOLLECTED BALANCE</span>
              <span className="text-lg font-black text-rose-600 dark:text-rose-400 font-mono mt-1 block">
                ₱{(totalAdvancesRemaining || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">TOTAL COLLECTED VIA PAYSLIPS</span>
              <span className="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono mt-1 block">
                ₱{(totalAdvancesCollected || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Add / Edit Cash Advance Form */}
          {isAddingAdvance && (
            <form onSubmit={handleAdvanceSubmit} className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border-2 border-rose-500/30 dark:border-rose-500/20 space-y-4 shadow-xl animate-in fade-in slide-in-from-top-4">
              <div className="flex items-center justify-between border-b border-zinc-150 dark:border-zinc-800 pb-3">
                <h3 className="text-sm font-black text-zinc-900 dark:text-zinc-100">
                  {editingAdvanceId ? "Edit Cash Advance Record" : "Record New Cash Advance"}
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-md">
                  Payslip Deduction (-)
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Employee (Borrower)</label>
                  <select 
                    value={advEmployeeId} 
                    onChange={(e) => setAdvEmployeeId(e.target.value)}
                    required
                    disabled={!!editingAdvanceId}
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 outline-none"
                  >
                    <option value="">Select Employee</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>{e.fullName}</option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Total Loan Amount (₱)</label>
                  <input 
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={advAmount || ""}
                    onChange={(e) => setAdvAmount(parseFloat(e.target.value))}
                    required
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 outline-none font-mono font-bold text-rose-600 dark:text-rose-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Date Granted</label>
                  <input 
                    type="date"
                    value={advDate}
                    onChange={(e) => setAdvDate(e.target.value)}
                    required
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Deduction Method</label>
                  <select
                    value={advDeductionMethod}
                    onChange={(e) => setAdvDeductionMethod(e.target.value as DeductionMethod)}
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 outline-none"
                  >
                    <option value="Full">Full (Deduct entire balance in next cutoff)</option>
                    <option value="Split">Split Across Cutoffs</option>
                    <option value="Manual">Manual Deduction Only</option>
                  </select>
                </div>

                {advDeductionMethod === "Split" && (
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Number of Splits</label>
                    <input 
                      type="number"
                      min="2"
                      max="24"
                      value={advSplitCount}
                      onChange={(e) => setAdvSplitCount(parseInt(e.target.value) || 2)}
                      required
                      className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 outline-none font-mono"
                    />
                  </div>
                )}

                <div className={advDeductionMethod === "Split" ? "md:col-span-1" : "md:col-span-2"}>
                  <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Notes / Reason (Optional)</label>
                  <input 
                    type="text"
                    value={advNotes}
                    onChange={(e) => setAdvNotes(e.target.value)}
                    placeholder="Reason or reference..."
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-rose-500 outline-none"
                  />
                </div>

                <div className="md:col-span-2 p-3 bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/60 rounded-xl space-y-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={advIsDeferred}
                      onChange={(e) => setAdvIsDeferred(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded text-purple-600 border-zinc-300 dark:border-zinc-600 focus:ring-purple-500 cursor-pointer"
                    />
                    <div className="flex-1 text-xs">
                      <div className="font-bold text-purple-950 dark:text-purple-200 flex items-center gap-1.5">
                        <EyeOff className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                        <span>Hide from current payslip (Deduct in next cutoff upon employee request)</span>
                      </div>
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-0.5">
                        Hold this deduction and postpone it to the next cutoff cycle without subtracting from this payslip.
                      </div>
                    </div>
                  </label>
                  {advIsDeferred && (
                    <input
                      type="text"
                      value={advDeferReason}
                      onChange={(e) => setAdvDeferReason(e.target.value)}
                      placeholder="Reason for postponing (e.g. Employee asked to postpone deduction to next cutoff)"
                      className="w-full text-xs px-3 py-1.5 bg-white dark:bg-zinc-900 border border-purple-200 dark:border-purple-700 rounded-lg outline-none text-zinc-900 dark:text-zinc-100 focus:border-purple-500"
                    />
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-zinc-150 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={resetAdvanceForm}
                  className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-bold shadow-sm transition-colors cursor-pointer"
                >
                  {editingAdvanceId ? "Update Advance" : "Save Advance"}
                </button>
              </div>
            </form>
          )}

          {/* Cash Advances Table */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden flex flex-col min-h-[350px]">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-zinc-50/50 dark:bg-zinc-900/50">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={15} />
                <input 
                  type="text" 
                  placeholder="Search advances by name or ref ID..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs focus:ring-2 focus:ring-rose-500 outline-none transition-all dark:text-zinc-100"
                />
              </div>
              <div className="flex items-center gap-2">
                {selectedAdvanceIds.length > 0 && (
                  <button
                    onClick={() => handleOpenBatchDelete("advances")}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} />
                    <span>Delete Selected ({selectedAdvanceIds.length})</span>
                  </button>
                )}
                <div className="text-[11px] font-bold text-zinc-500">
                  {filteredAdvances.length} record{filteredAdvances.length !== 1 ? "s" : ""}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 uppercase font-mono text-[10px]">
                  <tr>
                    <th className="w-10 px-4 py-3 text-center">
                      <button 
                        type="button" 
                        onClick={toggleSelectAllAdvances} 
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                        title={selectedAdvanceIds.length === filteredAdvances.length ? "Deselect All" : "Select All"}
                      >
                        {selectedAdvanceIds.length > 0 && selectedAdvanceIds.length === filteredAdvances.length ? (
                          <CheckSquare size={15} className="text-rose-500" />
                        ) : (
                          <Square size={15} />
                        )}
                      </button>
                    </th>
                    <th className="px-5 py-3 font-bold">Reference ID</th>
                    <th className="px-5 py-3 font-bold">Employee</th>
                    <th className="px-5 py-3 font-bold">Amount / Balance</th>
                    <th className="px-5 py-3 font-bold">Method</th>
                    <th className="px-5 py-3 font-bold">Status</th>
                    <th className="px-5 py-3 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150 dark:divide-zinc-800">
                  {filteredAdvances.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                        <p>No cash advances found.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredAdvances.map(adv => {
                      const isSelected = selectedAdvanceIds.includes(adv.id || adv.referenceId);
                      return (
                        <tr key={adv.id || adv.referenceId} className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors ${isSelected ? "bg-rose-50/40 dark:bg-rose-950/20" : ""}`}>
                          <td className="w-10 px-4 py-3.5 text-center">
                            <button
                              type="button"
                              onClick={() => toggleSelectAdvance(adv)}
                              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare size={15} className="text-rose-500" />
                              ) : (
                                <Square size={15} />
                              )}
                            </button>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-[11px] font-bold">{adv.referenceId}</td>
                          <td className="px-5 py-3.5 font-medium text-zinc-900 dark:text-zinc-100">{adv.employeeName}</td>
                          <td className="px-5 py-3.5">
                            <div className="flex flex-col">
                              <span className="font-bold text-rose-600 dark:text-rose-400 font-mono">
                                -₱{(adv.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                              <span className="text-[10px] text-zinc-500 font-mono">
                                Bal: ₱{(adv.remainingBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-zinc-600 dark:text-zinc-300">
                            {adv.deductionMethod} {adv.splitCount ? `(${adv.splitCount} splits)` : ""}
                          </td>
                          <td className="px-5 py-3.5">
                            {adv.status === "Pending" ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                                <AlertCircle size={10} /> Pending
                              </span>
                            ) : adv.status === "Active" ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                                <Clock size={10} /> Active
                              </span>
                            ) : adv.status === "Fully Paid" ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                <CheckCircle2 size={10} /> Paid
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                                Cancelled
                              </span>
                            )}
                            {adv.isDeferred && (
                              <span className="block mt-1 text-[9px] font-bold text-purple-600 dark:text-purple-400 font-mono">
                                ↳ Deferred (Next Cutoff)
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex justify-end items-center gap-1">
                              {/* 1-Click Toggle Deferred / Active in Payslip */}
                              <button 
                                type="button"
                                onClick={() => handleToggleAdvanceDeferred(adv)}
                                className={`p-1.5 rounded transition-colors cursor-pointer ${
                                  adv.isDeferred 
                                    ? "text-purple-600 hover:text-purple-700 bg-purple-50 dark:bg-purple-950/40 dark:text-purple-300" 
                                    : "text-zinc-400 hover:text-purple-600 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                }`}
                                title={adv.isDeferred ? "Currently Hidden from current payslip: Click to restore & deduct in current cutoff" : "Currently Active: Click to hide / postpone deduction to next cutoff"}
                              >
                                {adv.isDeferred ? <EyeOff size={16} /> : <Eye size={16} />}
                              </button>
                              <button 
                                onClick={() => setViewingAdvanceHistory(adv)}
                                className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                                title="View History"
                              >
                                <History size={16} />
                              </button>
                              {adv.remainingBalance > 0 && adv.status !== "Cancelled" && (
                                <button 
                                  onClick={() => { setManualDeductAdvance(adv); setManualDeductAmount(0); }}
                                  className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20 rounded transition-colors cursor-pointer"
                                  title="Manual Deduction"
                                >
                                  <Banknote size={16} />
                                </button>
                              )}
                              <button 
                                onClick={() => handleEditAdvance(adv)}
                                className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20 rounded transition-colors cursor-pointer"
                                title="Edit"
                              >
                                <Edit size={16} />
                              </button>
                              <button 
                                onClick={() => {
                                  setDeleteErrorMessage(null);
                                  setConfirmDeleteAdvance(adv);
                                }}
                                className="p-1.5 rounded transition-colors cursor-pointer text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/20"
                                title="Delete"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODALS: MANUAL DEDUCTION / MANUAL PAYOUT / HISTORIES */}
      {/* ========================================================= */}

      {/* Boss Debt Manual Payout Modal */}
      {manualPayoutDebt && (
        <div className="fixed inset-0 bg-black/60 overflow-y-auto flex justify-center p-4 z-55 backdrop-blur-xs">
          <div className="my-auto bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-100 dark:border-emerald-900/50">
              <h3 className="font-black text-sm text-emerald-900 dark:text-emerald-200 uppercase tracking-wide flex items-center gap-2">
                <Banknote size={18} className="text-emerald-600" />
                Manual Cash Payout Handover
              </h3>
              <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-1">
                Record cash handed over in-person directly by the boss outside payroll.
              </p>
            </div>
            <form onSubmit={handleManualPayoutSubmit} className="p-6 space-y-4">
              <div>
                <p className="text-xs text-zinc-500 mb-1">
                  Payee: <strong className="text-zinc-900 dark:text-white">{manualPayoutDebt.employeeName}</strong>
                </p>
                <p className="text-xs text-zinc-500 mb-3 font-mono">
                  Remaining Balance: <strong className="text-emerald-600 dark:text-emerald-400 font-bold">₱{(manualPayoutDebt.remainingBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                </p>
                <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Amount Paid in Cash (₱)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={manualPayoutDebt.remainingBalance}
                  value={manualPayoutAmount || ""}
                  onChange={(e) => setManualPayoutAmount(parseFloat(e.target.value) || 0)}
                  required
                  className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-mono font-bold text-emerald-600"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Handover Note / Receipt Memo</label>
                <input
                  type="text"
                  value={manualPayoutNote}
                  onChange={(e) => setManualPayoutNote(e.target.value)}
                  placeholder="e.g. Boss gave cash in office on Friday afternoon..."
                  className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none text-xs"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setManualPayoutDebt(null)} className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 cursor-pointer">
                  Confirm Cash Payout
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Boss Debt History Modal */}
      {viewingDebtHistory && (
        <div className="fixed inset-0 bg-black/60 overflow-y-auto flex justify-center p-4 z-55 backdrop-blur-xs">
          <div className="my-auto bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
              <div>
                <h3 className="font-black text-sm text-zinc-900 dark:text-zinc-50 uppercase tracking-wide flex items-center gap-2">
                  <History size={16} className="text-emerald-500" />
                  Additional Cash Payout History
                </h3>
                <p className="text-[10px] text-zinc-500 mt-0.5">{viewingDebtHistory.referenceId} — {viewingDebtHistory.employeeName}</p>
              </div>
              <button onClick={() => setViewingDebtHistory(null)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer font-bold">✕</button>
            </div>
            <div className="p-6">
              <div className="mb-4 p-3 bg-zinc-50 dark:bg-zinc-900/60 rounded-xl border border-zinc-150 dark:border-zinc-800 flex justify-between items-center text-xs">
                <div>
                  <span className="text-zinc-400 block text-[10px] uppercase font-bold">Original Committed Amount</span>
                  <span className="font-mono font-bold text-zinc-900 dark:text-white">₱{(viewingDebtHistory.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <div>
                  <span className="text-zinc-400 block text-[10px] uppercase font-bold">Remaining Balance</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">₱{(viewingDebtHistory.remainingBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>

              {!viewingDebtHistory.history || viewingDebtHistory.history.length === 0 ? (
                <p className="text-center text-xs text-zinc-500 py-6">No payouts recorded yet. Amount will be added on the next cutoff payslip.</p>
              ) : (
                <div className="space-y-2.5 max-h-72 overflow-y-auto">
                  {viewingDebtHistory.history.map((h, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-150 dark:border-zinc-800">
                      <div>
                        <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">{new Date(h.date).toLocaleDateString()}</p>
                        <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{h.periodId}</p>
                        {h.note && <p className="text-[10px] text-zinc-400 italic mt-0.5">{h.note}</p>}
                      </div>
                      <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-xs">
                        +₱{(h.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cash Advance Manual Deduction Modal */}
      {manualDeductAdvance && (
        <div className="fixed inset-0 bg-black/50 overflow-y-auto flex justify-center p-4 z-55 backdrop-blur-xs">
          <div className="my-auto bg-white dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-150 dark:border-zinc-800">
              <h3 className="font-bold text-sm text-zinc-800 dark:text-zinc-50 uppercase tracking-wide">Manual Deduction</h3>
              <p className="text-[10px] text-zinc-500 mt-1">Deduct directly from remaining balance outside payroll.</p>
            </div>
            <form onSubmit={handleManualDeductSubmit} className="p-6 space-y-4">
              <div>
                <p className="text-xs text-zinc-500 mb-2">Remaining Balance: <strong className="text-zinc-900 dark:text-white">₱{(manualDeductAdvance.remainingBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></p>
                <label className="block text-[10px] font-bold text-zinc-500 font-mono uppercase mb-1">Deduction Amount</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={manualDeductAdvance.remainingBalance}
                  value={manualDeductAmount || ""}
                  onChange={(e) => setManualDeductAmount(parseFloat(e.target.value))}
                  required
                  className="w-full bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-zinc-900 outline-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setManualDeductAdvance(null)} className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 cursor-pointer">Apply Deduction</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cash Advance History Modal */}
      {viewingAdvanceHistory && (
        <div className="fixed inset-0 bg-black/50 overflow-y-auto flex justify-center p-4 z-55 backdrop-blur-xs">
          <div className="my-auto bg-white dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-150 dark:border-zinc-800 flex justify-between items-center">
              <div>
                <h3 className="font-bold text-sm text-zinc-800 dark:text-zinc-50 uppercase tracking-wide">Deduction History</h3>
                <p className="text-[10px] text-zinc-500 mt-1">{viewingAdvanceHistory.referenceId} - {viewingAdvanceHistory.employeeName}</p>
              </div>
              <button onClick={() => setViewingAdvanceHistory(null)} className="text-zinc-400 hover:text-zinc-600 cursor-pointer">✕</button>
            </div>
            <div className="p-6">
              {!viewingAdvanceHistory.history || viewingAdvanceHistory.history.length === 0 ? (
                <p className="text-center text-sm text-zinc-500 py-4">No deductions recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {viewingAdvanceHistory.history.map((h, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-100 dark:border-zinc-800">
                      <div>
                        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{new Date(h.date).toLocaleDateString()}</p>
                        <p className="text-[10px] text-zinc-500 font-mono mt-0.5">Period: {h.periodId}</p>
                      </div>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-500">
                        -₱{(h.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* CUSTOM IN-APP CONFIRMATION MODALS (REPLACES BROWSER CONFIRM) */}
      {/* ========================================================= */}

      {/* 1. Single Boss Debt Delete Modal */}
      {confirmDeleteDebt && (
        <div className="fixed inset-0 bg-black/60 overflow-y-auto flex justify-center p-4 z-60 backdrop-blur-xs">
          <div className="my-auto bg-white dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-900/40 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-rose-600/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-zinc-900 dark:text-zinc-50">Delete Boss Cash Credit?</h3>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">This action will remove the credit from records</p>
                </div>
              </div>
              <button 
                onClick={() => { setConfirmDeleteDebt(null); setDeleteErrorMessage(null); }} 
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Record Summary Card */}
              <div className="p-4 bg-zinc-50 dark:bg-zinc-900/60 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs">
                <div className="flex justify-between items-center pb-2 border-b border-zinc-150 dark:border-zinc-800 font-mono">
                  <span className="text-zinc-400 text-[10px] uppercase font-bold">Reference ID:</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">{confirmDeleteDebt.referenceId}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Employee Payee:</span>
                  <strong className="text-zinc-900 dark:text-zinc-100">{confirmDeleteDebt.employeeName}</strong>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Amount Committed:</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    +₱{(confirmDeleteDebt.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Remaining Balance:</span>
                  <span className="font-mono font-bold text-zinc-700 dark:text-zinc-300">
                    ₱{(confirmDeleteDebt.remainingBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                {confirmDeleteDebt.notes && (
                  <div className="pt-2 border-t border-zinc-150 dark:border-zinc-800">
                    <span className="text-zinc-400 text-[10px] uppercase block font-bold">Reason / Note:</span>
                    <span className="text-zinc-700 dark:text-zinc-300 italic">{confirmDeleteDebt.notes}</span>
                  </div>
                )}
              </div>

              {deleteErrorMessage && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-bold">Deletion Error:</strong>
                    <span>{deleteErrorMessage}</span>
                  </div>
                </div>
              )}

              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Are you sure you want to permanently delete this boss debt entry? It will no longer disburse into upcoming payrolls.
              </p>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-zinc-150 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => { setConfirmDeleteDebt(null); setDeleteErrorMessage(null); }}
                  className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => executeDeleteDebt(confirmDeleteDebt)}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirm Delete</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Single Cash Advance Delete Modal */}
      {confirmDeleteAdvance && (
        <div className="fixed inset-0 bg-black/60 overflow-y-auto flex justify-center p-4 z-60 backdrop-blur-xs">
          <div className="my-auto bg-white dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 w-full max-w-md rounded-2xl overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-900/40 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-rose-600/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-zinc-900 dark:text-zinc-50">Delete Cash Advance?</h3>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">Remove loan / advance from deduction ledger</p>
                </div>
              </div>
              <button 
                onClick={() => { setConfirmDeleteAdvance(null); setDeleteErrorMessage(null); }} 
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-zinc-50 dark:bg-zinc-900/60 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs">
                <div className="flex justify-between items-center pb-2 border-b border-zinc-150 dark:border-zinc-800 font-mono">
                  <span className="text-zinc-400 text-[10px] uppercase font-bold">Reference ID:</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">{confirmDeleteAdvance.referenceId}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Employee Borrower:</span>
                  <strong className="text-zinc-900 dark:text-zinc-100">{confirmDeleteAdvance.employeeName}</strong>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Loan Amount:</span>
                  <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                    -₱{(confirmDeleteAdvance.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">Remaining Balance:</span>
                  <span className="font-mono font-bold text-zinc-700 dark:text-zinc-300">
                    ₱{(confirmDeleteAdvance.remainingBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {deleteErrorMessage && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-bold">Deletion Error:</strong>
                    <span>{deleteErrorMessage}</span>
                  </div>
                </div>
              )}

              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Are you sure you want to delete this cash advance? Future payslips will no longer deduct this advance.
              </p>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-zinc-150 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => { setConfirmDeleteAdvance(null); setDeleteErrorMessage(null); }}
                  className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => executeDeleteAdvance(confirmDeleteAdvance)}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirm Delete</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Batch Delete Confirmation Modal */}
      {isConfirmBatchDeleteOpen && (
        <div className="fixed inset-0 bg-black/60 overflow-y-auto flex justify-center p-4 z-60 backdrop-blur-xs">
          <div className="my-auto bg-white dark:bg-zinc-950 border border-zinc-250 dark:border-zinc-800 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-900/40 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-rose-600/10 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-extrabold text-sm text-zinc-900 dark:text-zinc-50">
                    Delete Multiple Records?
                  </h3>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono">
                    {batchDeleteType === "boss_debts" 
                      ? `${selectedDebtIds.length} Boss Cash Credit record(s) selected` 
                      : `${selectedAdvanceIds.length} Cash Advance record(s) selected`}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setIsConfirmBatchDeleteOpen(false); setDeleteErrorMessage(null); }} 
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="p-4 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs space-y-1.5 text-amber-900 dark:text-amber-200">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Permanent Batch Deletion</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  You are about to delete <strong>{batchDeleteType === "boss_debts" ? selectedDebtIds.length : selectedAdvanceIds.length} records</strong>. This operation will remove all selected items from cloud and local cache.
                </p>
              </div>

              {/* List preview of items being deleted */}
              <div className="max-h-48 overflow-y-auto space-y-1.5 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 bg-zinc-50 dark:bg-zinc-900/50 text-xs font-mono">
                {batchDeleteType === "boss_debts" ? (
                  bossDebts
                    .filter(d => (d.id && selectedDebtIds.includes(d.id)) || (d.referenceId && selectedDebtIds.includes(d.referenceId)))
                    .map(d => (
                      <div key={d.id || d.referenceId} className="flex justify-between items-center py-1 border-b border-zinc-150 dark:border-zinc-800 last:border-0">
                        <span className="font-bold text-zinc-800 dark:text-zinc-200">{d.referenceId} ({d.employeeName})</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">+₱{(d.amount || 0).toLocaleString()}</span>
                      </div>
                    ))
                ) : (
                  advances
                    .filter(a => (a.id && selectedAdvanceIds.includes(a.id)) || (a.referenceId && selectedAdvanceIds.includes(a.referenceId)))
                    .map(a => (
                      <div key={a.id || a.referenceId} className="flex justify-between items-center py-1 border-b border-zinc-150 dark:border-zinc-800 last:border-0">
                        <span className="font-bold text-zinc-800 dark:text-zinc-200">{a.referenceId} ({a.employeeName})</span>
                        <span className="text-rose-600 dark:text-rose-400 font-bold">-₱{(a.amount || 0).toLocaleString()}</span>
                      </div>
                    ))
                )}
              </div>

              {deleteErrorMessage && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-bold">Deletion Error:</strong>
                    <span>{deleteErrorMessage}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2 border-t border-zinc-150 dark:border-zinc-800">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => { setIsConfirmBatchDeleteOpen(false); setDeleteErrorMessage(null); }}
                  className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={executeBatchDelete}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer flex items-center gap-1.5"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting {batchDeleteType === "boss_debts" ? selectedDebtIds.length : selectedAdvanceIds.length} Records...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirm Delete All Selected</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
