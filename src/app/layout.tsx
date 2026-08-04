import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Instrument_Serif, Inter_Tight } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const corpo = Inter_Tight({
  variable: "--fonte-corpo",
  subsets: ["latin"],
  display: "swap",
});

const display = Instrument_Serif({
  variable: "--fonte-display",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--fonte-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "POC — Processos",
    template: "%s · POC",
  },
  description: "Plataforma de processos jurídicos — onboarding de clientes.",
};

/**
 * `interactiveWidget: "resizes-content"` — sem isto, o teclado virtual em
 * Android/iOS sobrepõe-se ao layout em vez de o encolher, e o quadro de
 * assinatura do passo 7 fica escondido atrás do teclado.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-PT"
      className={`${corpo.variable} ${display.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
