import type { Metadata } from "next"
import { AuthTerminal } from "@/components/auth-terminal"

export const metadata: Metadata = {
  title: "Giriş Yap | F-Borsam",
  description: "F-Borsam piyasa analiz terminaline güvenli giriş yapın.",
}

export default function SignInPage() {
  return <AuthTerminal initialMode="sign-in" />
}
