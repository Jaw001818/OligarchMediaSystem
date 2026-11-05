import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronDown, Check, X, User } from "lucide-react";
import { Employee } from "../types";

interface EmployeeSearchInputProps {
  label: string;
  valueName: string;
  valueId?: string;
  employees: Employee[];
  onChange: (selected: { id: string; name: string }) => void;
  placeholder?: string;
  required?: boolean;
  roleBadge?: string;
}

export default function EmployeeSearchInput({
  label,
  valueName,
  valueId,
  employees,
  onChange,
  placeholder = "Search employee name or ID...",
  required = false,
  roleBadge
}: EmployeeSearchInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(valueName || "");
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync internal searchTerm when external valueName changes
  useEffect(() => {
    setSearchTerm(valueName || "");
  }, [valueName]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter active employees
  const filteredEmployees = useMemo(() => {
    const active = employees.filter((e) => (e.status || "Active") === "Active");
    const query = searchTerm.trim().toLowerCase();
    if (!query) return active;

    return active.filter((emp) => {
      const matchName = (emp.fullName || "").toLowerCase().includes(query);
      const matchNumber = (emp.employeeNumber || "").toLowerCase().includes(query);
      const matchDept = (emp.department || "").toLowerCase().includes(query);
      const matchPos = (emp.position || "").toLowerCase().includes(query);
      return matchName || matchNumber || matchDept || matchPos;
    });
  }, [employees, searchTerm]);

  // Check if current input matches a directory employee
  const matchedEmployee = useMemo(() => {
    if (valueId) {
      const byId = employees.find((e) => e.id === valueId);
      if (byId) return byId;
    }
    const cleanSearch = searchTerm.trim().toLowerCase();
    if (!cleanSearch) return null;
    return (
      employees.find(
        (e) =>
          e.fullName.toLowerCase() === cleanSearch ||
          e.fullName.toLowerCase().includes(cleanSearch) ||
          cleanSearch.includes(e.fullName.toLowerCase())
      ) || null
    );
  }, [employees, valueId, searchTerm]);

  const handleSelect = (emp: Employee) => {
    setSearchTerm(emp.fullName);
    onChange({ id: emp.id || "", name: emp.fullName });
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = e.target.value;
    setSearchTerm(newVal);
    setIsOpen(true);
    setHighlightedIndex(-1);
    
    // Check if what they typed exactly matches an employee
    const match = employees.find(
      (emp) => emp.fullName.toLowerCase() === newVal.trim().toLowerCase()
    );
    if (match) {
      onChange({ id: match.id || "", name: match.fullName });
    } else {
      onChange({ id: "", name: newVal });
    }
  };

  const handleClear = () => {
    setSearchTerm("");
    onChange({ id: "", name: "" });
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === "ArrowDown" || e.key === "Enter")) {
      setIsOpen(true);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredEmployees.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredEmployees.length - 1
      );
    } else if (e.key === "Enter") {
      if (isOpen && highlightedIndex >= 0 && filteredEmployees[highlightedIndex]) {
        e.preventDefault();
        handleSelect(filteredEmployees[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div className="space-y-1 relative" ref={containerRef}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-mono font-bold text-zinc-400 uppercase flex items-center gap-1.5">
          <span>{label}</span>
          {roleBadge && (
            <span className="text-[10px] font-sans font-normal text-indigo-400">
              {roleBadge}
            </span>
          )}
        </label>
        {matchedEmployee && (
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
            <Check className="w-2.5 h-2.5" />
            <span>ID #{matchedEmployee.employeeNumber}</span>
          </span>
        )}
      </div>

      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
          <Search className="w-4 h-4" />
        </div>

        <input
          ref={inputRef}
          type="text"
          required={required}
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full text-xs font-mono pl-9 pr-16 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all shadow-inner"
        />

        <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-1">
          {searchTerm && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
              title="Clear input"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
            title="Toggle directory list"
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-150 ${
                isOpen ? "rotate-180 text-indigo-400" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {/* Floating Dropdown Results */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl divide-y divide-zinc-850 animate-in fade-in duration-100">
          <div className="px-3 py-1.5 bg-zinc-900/80 text-[10px] font-mono text-zinc-400 flex justify-between items-center sticky top-0 backdrop-blur-xs">
            <span>EMPLOYEE DIRECTORY SEARCH</span>
            <span>{filteredEmployees.length} matching</span>
          </div>

          {filteredEmployees.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-400 font-mono">
              <p>No employee found matching "{searchTerm}".</p>
              <p className="text-[10px] text-zinc-500 mt-1">
                You can press enter to keep "{searchTerm}" as a custom name.
              </p>
            </div>
          ) : (
            filteredEmployees.map((emp, idx) => {
              const isSelected =
                (valueId && emp.id === valueId) ||
                emp.fullName.toLowerCase() === searchTerm.trim().toLowerCase();
              const isHighlighted = idx === highlightedIndex;

              return (
                <button
                  key={emp.id || emp.employeeNumber}
                  type="button"
                  onClick={() => handleSelect(emp)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-indigo-950/40 text-indigo-200"
                      : isHighlighted
                      ? "bg-zinc-900 text-white"
                      : "hover:bg-zinc-900/60 text-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold shrink-0">
                      #{emp.employeeNumber}
                    </span>
                    <div className="truncate">
                      <div className="text-xs font-bold truncate text-white">
                        {emp.fullName}
                      </div>
                      {(emp.position || emp.department) && (
                        <div className="text-[10px] text-zinc-400 truncate">
                          {[emp.position, emp.department].filter(Boolean).join(" • ")}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 ml-2" />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
