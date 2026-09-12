"use client"

import type { ReactNode } from "react"

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-surface p-6 ${className}`}>{children}</div>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button",
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: "primary" | "ghost"
  type?: "button" | "submit"
}) {
  const base =
    "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  const styles =
    variant === "primary"
      ? "bg-accent text-background hover:opacity-90"
      : "border border-line hover:bg-line/40"
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      {children}
    </button>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

export const inputClass =
  "w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs break-all text-muted">{children}</span>
}

/** Countdown against a real expiry, not a UI timer. */
export function timeLeft(expiresAt: number): string {
  const seconds = expiresAt - Math.floor(Date.now() / 1000)
  if (seconds <= 0) return "expired"
  if (seconds < 60) return `${seconds}s left`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m left`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h left`
  return `${Math.floor(seconds / 86400)}d left`
}
