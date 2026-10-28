'use client'

import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/overlay'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={250}>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: '!bg-surface !text-fg !border-border !shadow-float !rounded-xl',
              description: '!text-muted',
            },
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  )
}
