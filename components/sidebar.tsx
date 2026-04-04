'use client'

import { cn } from '@/lib/utils'
import { useArenaStore } from '@/lib/store'
import { 
  MessageSquare, 
  Swords, 
  Settings, 
  Zap,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Sparkles,
  BarChart3,
  Coins,
  RotateCcw,
  ShieldCheck,
  AlertTriangle,
  Send,
  Globe,
  Code
} from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SettingsDialog } from './settings-dialog'

export function Sidebar({ isMobile }: { isMobile?: boolean }) {
  const activeTab = useArenaStore(state => state.activeTab)
  const setActiveTab = useArenaStore(state => state.setActiveTab)
  const setSidebarOpen = useArenaStore(state => state.setSidebarOpen)
  
  const [collapsed, setCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [budgetCollapsed, setBudgetCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('budgetCollapsed') === 'true'
    }
    return false
  })
  
  const { sessionCost, maxSessionBudget, setMaxSessionBudget, resetSessionCost } = useArenaStore()
  const budgetPercentage = Math.min((sessionCost / maxSessionBudget) * 100, 100)
  const isBudgetCritical = sessionCost >= maxSessionBudget * 0.9

  const handleNav = (tab: 'chat' | 'arena' | 'dashboard' | 'telegram' | 'events' | 'ide') => {
    setActiveTab(tab)
    if (isMobile) {
      setSidebarOpen(false)
    }
  }

  const navItems = [
    { id: 'chat' as const, label: 'Chat', icon: MessageSquare, description: 'Multi-model chat' },
    { id: 'ide' as const, label: 'IDE', icon: Code, description: 'Chat with file explorer' },
    { id: 'arena' as const, label: 'Arena', icon: Swords, description: 'Model orchestration' },
    { id: 'events' as const, label: 'Events', icon: Globe, description: 'Event simulation' },
    { id: 'dashboard' as const, label: 'Analytics', icon: BarChart3, description: 'Usage & cost' },
    { id: 'telegram' as const, label: 'Telegram', icon: Send, description: 'Bot management' },
  ]

  return (
    <TooltipProvider>
      <div
        className={cn(
          'flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 h-full',
          !isMobile && collapsed ? 'w-16' : 'w-full lg:w-64'
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 p-4 border-b border-sidebar-border">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-lg font-semibold text-sidebar-foreground">Ἥφαιστος</span>
              <span className="text-xs text-muted-foreground">LLM Arena</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = activeTab === item.id

              return collapsed ? (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleNav(item.id)}
                      className={cn(
                        'w-full flex items-center justify-center p-3 rounded-lg transition-all',
                        isActive
                          ? 'bg-sidebar-accent text-primary'
                          : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      )}
                    >
                      <Icon className="w-5 h-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p className="font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <button
                  key={item.id}
                  onClick={() => handleNav(item.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
                    isActive
                      ? 'bg-sidebar-accent text-primary'
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <div className="flex flex-col items-start">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="text-xs opacity-70">{item.description}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </nav>

        {/* Budget Monitor */}
        {!collapsed && (
          <div className="mx-3 mb-4 space-y-2">
            <div className="flex items-center justify-between px-1">
              <button 
                onClick={() => {
                  const newVal = !budgetCollapsed
                  setBudgetCollapsed(newVal)
                  localStorage.setItem('budgetCollapsed', String(newVal))
                }}
                className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground/80 hover:text-muted-foreground transition-colors"
              >
                <ChevronDown className={cn("w-3 h-3 transition-transform", budgetCollapsed && "-rotate-90")} />
                Session Budget
              </button>
              {!budgetCollapsed && (
                <button 
                  onClick={resetSessionCost}
                  className="p-1 hover:bg-primary/10 rounded transition-colors group"
                  title="Reset session cost"
                >
                  <RotateCcw className="w-3 h-3 text-muted-foreground group-hover:rotate-[20deg] transition-transform" />
                </button>
              )}
            </div>
            
            {!budgetCollapsed && (
              <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 space-y-3 font-sans">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-end">
                    <span className="text-xl font-bold tabular-nums text-primary/95 antialiased">${sessionCost.toFixed(3)}</span>
                    <div className="flex items-center gap-1.5 pb-1">
                      <span className="text-[10px] text-muted-foreground font-medium opacity-50">Limit: $</span>
                      <input 
                        type="number"
                        step="0.1"
                        min="0"
                        value={maxSessionBudget}
                        onChange={(e) => setMaxSessionBudget(parseFloat(e.target.value) || 0)}
                        className="w-12 bg-transparent border-none p-0 text-[10px] focus:ring-0 font-extrabold text-primary underline decoration-dotted decoration-primary/20"
                      />
                    </div>
                  </div>
                  <Progress value={budgetPercentage} className={cn("h-1.5 overflow-hidden", isBudgetCritical ? "[&>div]:bg-amber-500" : "[&>div]:bg-emerald-500")} />
                </div>

                {isBudgetCritical && (
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-500 font-semibold animate-pulse pt-0.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Nearing budget limit</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bottom section */}
        <div className="p-3 border-t border-sidebar-border">

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSettingsOpen(true)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-all',
                  collapsed ? 'justify-center w-full' : ''
                )}
              >
                <Settings className="w-5 h-5" />
                {!collapsed && <span className="text-sm">Settings</span>}
              </button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">
                <p>Settings</p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>

      </div>
      
      {/* Collapse button - outside the flex container - only show on desktop */}
      {!isMobile && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="absolute top-1/2 -translate-y-1/2 right-0 translate-x-1/2 z-10 w-6 h-6 rounded-full bg-sidebar border border-sidebar-border hover:bg-sidebar-accent"
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3" />
          ) : (
            <ChevronLeft className="w-3 h-3" />
          )}
        </Button>
      )}

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </TooltipProvider>
  )
}
