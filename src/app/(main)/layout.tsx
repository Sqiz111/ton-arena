import { Header } from '@/components/layout/header'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <Header />
      <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 md:pb-12">{children}</main>
    </div>
  )
}
