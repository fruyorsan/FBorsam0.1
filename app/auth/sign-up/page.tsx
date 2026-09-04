import type { Metadata } from "next"
import { AuthTerminal } from "@/components/auth-terminal"

export const metadata: Metadata = {
  title: "Hesap Oluştur | F-Borsam",
  description: "F-Borsam piyasa analiz terminalinde hesabınızı oluşturun.",
}

export default function SignUpPage() {
  return <AuthTerminal initialMode="sign-up" />
}
