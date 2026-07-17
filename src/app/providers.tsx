'use client'

import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TonConnectUIProvider } from '@tonconnect/ui-react'
import { ThemeProvider } from 'next-themes'

export function Providers({ children, manifestUrl }: { children: ReactNode; manifestUrl: string }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  )

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <TonConnectUIProvider manifestUrl={manifestUrl}>{children}</TonConnectUIProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
