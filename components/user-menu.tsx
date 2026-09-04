"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  User,
  LogOut,
  UserPlus,
  RefreshCw,
  ShieldCheck,
  ChevronDown,
  Sparkles,
  ExternalLink,
} from "lucide-react"
import { authClient } from "@/lib/auth/client"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function UserMenu() {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const sessionRes = authClient?.useSession ? authClient.useSession() : null
  const session = sessionRes?.data
  const [nickname, setNickname] = useState("Hesabım")
  const [userEmail, setUserEmail] = useState("")
  const menuRef = useRef<HTMLDivElement>(null)

  // Load account name and email from session or localStorage
  useEffect(() => {
    try {
      const savedNick = localStorage.getItem("f_borsam_nickname") || localStorage.getItem("piyasaiq:user:name")
      const savedEmail = localStorage.getItem("f_borsam_email")
      
      const sessionUser = session?.user
      const sessionName = sessionUser?.name && sessionUser.name !== "Analist" ? sessionUser.name : ""
      const sessionEmail = sessionUser?.email || ""

      const finalName = (savedNick && savedNick !== "Analist" ? savedNick : null)
        || sessionName
        || (savedEmail ? savedEmail.split("@")[0] : null)
        || (sessionEmail ? sessionEmail.split("@")[0] : null)
        || "Hesabım"

      const finalEmail = savedEmail || sessionEmail || ""

      setNickname(finalName)
      setUserEmail(finalEmail)
    } catch {}
  }, [session])

  // Calculate initials from nickname
  const initials = useMemo(() => {
    if (!nickname) return "TR"
    const parts = nickname.trim().split(" ")
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    return nickname.slice(0, 2).toUpperCase()
  }, [nickname])

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("keydown", handleKeyDown)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen])

  async function handleSignOut() {
    try {
      if (authClient?.signOut) {
        await authClient.signOut().catch(() => {})
      }
    } catch {
      // Ignore
    }
    // Delete session cookie if exists
    document.cookie = "f_borsam_session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;"
    setIsOpen(false)
    router.push("/auth/sign-in")
    router.refresh()
  }

  function handleSwitchAccount() {
    setIsOpen(false)
    router.push("/auth/sign-in")
  }

  function handleCreateAccount() {
    setIsOpen(false)
    router.push("/auth/sign-up")
  }

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      {/* Profile Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1 text-xs font-medium transition-all hover:border-primary/40 hover:bg-card/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          isOpen && "border-primary/50 bg-card/90 ring-2 ring-primary/20"
        )}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label="Kullanıcı hesabı menüsü"
      >
        <div className="relative flex size-6.5 items-center justify-center rounded-full bg-primary/15 text-primary font-mono font-bold text-[11px] ring-1 ring-primary/30">
          {initials}
          <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-positive ring-2 ring-background" />
        </div>
        <div className="hidden flex-col text-left sm:flex">
          <span className="text-[11px] font-semibold text-foreground leading-tight max-w-[120px] truncate">
            {nickname}
          </span>
          <span className="text-[9px] font-mono text-primary font-medium leading-tight">PRO</span>
        </div>
        <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 origin-top-right rounded-xl border border-border/80 bg-card/95 p-1.5 shadow-2xl backdrop-blur-2xl ring-1 ring-black/10 focus:outline-none z-50 animate-in fade-in-0 zoom-in-95">
          {/* User Profile Card Header */}
          <div className="rounded-lg bg-muted/40 p-3 border border-border/50 mb-1">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/20 text-primary font-mono font-bold text-xs ring-1 ring-primary/30">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-bold text-foreground truncate">{nickname}</p>
                  <span className="rounded bg-primary/15 px-1 py-0.2 font-mono text-[9px] font-bold text-primary">
                    PRO
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground truncate">{userEmail}</p>
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1 text-positive">
                <ShieldCheck className="size-3" /> Güvenli Oturum
              </span>
              <span className="font-mono text-[9px]">v2.4 TERMINAL</span>
            </div>
          </div>

          {/* Action Links */}
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={handleSwitchAccount}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 hover:text-primary text-left"
            >
              <RefreshCw className="size-3.5 text-primary" />
              <div className="flex-1">
                <p className="leading-tight">Hesap Değiştir</p>
                <p className="text-[10px] text-muted-foreground font-normal">Farklı bir e-posta ile giriş yap</p>
              </div>
            </button>

            <button
              type="button"
              onClick={handleCreateAccount}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-primary/10 hover:text-primary text-left"
            >
              <UserPlus className="size-3.5 text-primary" />
              <div className="flex-1">
                <p className="leading-tight">Yeni Hesap Oluştur</p>
                <p className="text-[10px] text-muted-foreground font-normal">Ücretsiz yeni bir analiz profili aç</p>
              </div>
            </button>
          </div>

          {/* Divider */}
          <div className="my-1 border-t border-border/60" />

          {/* Sign Out Button */}
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 text-left"
          >
            <LogOut className="size-3.5" />
            <span>Oturumu Kapat / Çıkış Yap</span>
          </button>
        </div>
      )}
    </div>
  )
}
