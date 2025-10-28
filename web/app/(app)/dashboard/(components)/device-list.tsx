'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Smartphone, Battery, Signal, Copy, Clock, Pause, Phone, MessageSquare, Timer, RotateCcw, ArrowUp } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { formatPhoneNumberDisplay } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { useState, useEffect } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface UsagePlan {
  _id: string
  name: string
  tiers: {
    tier: number
    min_wait_seconds: number
    messages_per_cycle: number
  }[]
}

interface Device {
  _id: string
  brand: string
  model: string
  enabled: boolean
  status: string
  createdAt: string
  current_tier: number
  messages_sent_today: number
  is_on_cooldown?: boolean
  cooldown_end_time?: string
  cooldown_reason?: 'tier_promotion' | 'max_tier_limit'
  pending_tier_upgrade?: number
  usagePlan?: string
  phoneNumber?: string
  usage_window_minutes?: number
  usage_percentage?: number
  estimated_cooldown_end?: string
  best_min_wait_seconds?: number
  max_messages_per_cycle?: number
}

export default function DeviceList() {
  const { toast } = useToast()
  const [currentTime, setCurrentTime] = useState(new Date())
  const [advanceTierDialogOpen, setAdvanceTierDialogOpen] = useState(false)
  const [resetHistoryDialogOpen, setResetHistoryDialogOpen] = useState(false)
  const [changePlanDialogOpen, setChangePlanDialogOpen] = useState(false)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)

  // Update current time every minute for live countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [])

  const {
    isPending,
    error,
    data: devices,
  } = useQuery<{ data: Device[] }>({
    queryKey: ['devices'],
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.listDevices())
        .then((res) => res.data),
  })

  const {
    data: usagePlans,
  } = useQuery<{ data: UsagePlan[] }>({
    queryKey: ['usage-plans'],
    queryFn: () => {
      console.log('🔧 DeviceList: Making usage plans API call to:', ApiEndpoints.gateway.getUserUsagePlans())
      return httpBrowserClient
        .get(ApiEndpoints.gateway.getUserUsagePlans())
        .then((res) => {
          console.log('🔧 DeviceList: Usage plans API response:', res.data)
          return res.data
        })
        .catch((err) => {
          console.error('🔧 DeviceList: Usage plans API error:', err)
          throw err
        })
    },
  })

  console.log('🔧 DeviceList: Usage plans query state:', { data: usagePlans })

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id)
    toast({
      title: 'Device ID copied to clipboard',
    })
  }

  const getCurrentTier = (device: Device) => {
    if (!device.usagePlan || !usagePlans?.data) return null
    const plan = usagePlans.data.find(p => p._id === device.usagePlan)
    if (!plan) return null
    return plan.tiers.find(t => t.tier === device.current_tier) || plan.tiers[0]
  }

  const getUsagePercentage = (device: Device) => {
    const tier = getCurrentTier(device)
    if (!tier) return 0
    return Math.min((device.messages_sent_today / tier.messages_per_cycle) * 100, 100)
  }

  const isDeviceOnCooldown = (device: Device) => {
    return device.is_on_cooldown || false
  }

  const isDeviceEligibleForAdvancement = (device: Device) => {
    if (!device.usagePlan || !usagePlans?.data) return false

    const plan = usagePlans.data.find(p => p._id === device.usagePlan)
    if (!plan) return false

    // Check if device has historical limits
    if (!device.best_min_wait_seconds || !device.max_messages_per_cycle) return false

    // Find highest eligible tier based on historical limits
    const sortedTiers = [...plan.tiers].sort((a, b) => b.tier - a.tier)

    for (const tier of sortedTiers) {
      const meetsWaitRequirement = tier.min_wait_seconds >= device.best_min_wait_seconds
      const meetsCycleRequirement = tier.messages_per_cycle <= device.max_messages_per_cycle

      if (meetsWaitRequirement && meetsCycleRequirement) {
        // Device is eligible for advancement if highest eligible tier is higher than current tier
        return tier.tier > device.current_tier
      }
    }

    return false
  }

  const getCooldownDisplay = (device: Device) => {
    if (!device.is_on_cooldown) return null

    let message = 'Cooldown'
    let timeDisplay = null

    if (device.cooldown_reason === 'tier_promotion') {
      const targetTier = device.pending_tier_upgrade || device.current_tier
      message = `Warming up to Tier ${targetTier}`
    } else if (device.cooldown_reason === 'max_tier_limit') {
      message = 'Max tier limit reached'
    }

    // Use cooldown_end_time if available, otherwise fall back to estimated_cooldown_end
    const endTime = device.cooldown_end_time || device.estimated_cooldown_end
    if (endTime) {
      timeDisplay = new Date(endTime).toLocaleString()
    }

    return { message, timeDisplay }
  }

  const formatTimeDelay = (seconds: number) => {
    if (seconds === 0) return 'No delay'
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (remainingSeconds === 0) return `${minutes}m`
    return `${minutes}m ${remainingSeconds}s`
  }

  const formatTimeRemaining = (endTime: Date | string) => {
    const end = new Date(endTime)
    const now = currentTime
    const diffMs = end.getTime() - now.getTime()

    if (diffMs <= 0) return 'Ending soon'

    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = Math.floor(diffMinutes / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) {
      const remainingHours = diffHours % 24
      if (remainingHours === 0) return `${diffDays}d`
      return `${diffDays}d ${remainingHours}h`
    }

    if (diffHours > 0) {
      const remainingMinutes = diffMinutes % 60
      if (remainingMinutes === 0) return `${diffHours}h`
      return `${diffHours}h ${remainingMinutes}m`
    }

    return `${diffMinutes}m`
  }

  const handlePlanChange = async () => {
    if (!selectedDeviceId || !selectedPlanId) return

    try {
      await httpBrowserClient.patch(
        ApiEndpoints.gateway.assignUsagePlan(selectedDeviceId),
        { usagePlanId: selectedPlanId }
      )
      toast({
        title: 'Usage plan changed successfully',
      })
      setChangePlanDialogOpen(false)
      setSelectedDeviceId(null)
      setSelectedPlanId(null)
      // Refetch devices to show updated data
      window.location.reload()
    } catch (error: any) {
      toast({
        title: 'Error changing usage plan',
        description: error.response?.data?.message || error.message,
        variant: 'destructive',
      })
      setChangePlanDialogOpen(false)
      setSelectedDeviceId(null)
      setSelectedPlanId(null)
    }
  }

  const handleAdvanceTier = async () => {
    if (!selectedDeviceId) return

    try {
      await httpBrowserClient.post(
        ApiEndpoints.gateway.advanceDeviceTier(selectedDeviceId)
      )
      toast({
        title: 'Device advanced to highest eligible tier',
      })
      setAdvanceTierDialogOpen(false)
      setSelectedDeviceId(null)
      // Refetch devices to show updated data
      window.location.reload()
    } catch (error: any) {
      toast({
        title: 'Error advancing device tier',
        description: error.response?.data?.message || error.message,
        variant: 'destructive',
      })
      setAdvanceTierDialogOpen(false)
      setSelectedDeviceId(null)
    }
  }

  const handleResetHistory = async () => {
    if (!selectedDeviceId) return

    try {
      await httpBrowserClient.post(
        ApiEndpoints.gateway.resetDeviceHistory(selectedDeviceId)
      )
      toast({
        title: 'Historical limits reset successfully',
      })
      setResetHistoryDialogOpen(false)
      setSelectedDeviceId(null)
      // Refetch devices to show updated data
      window.location.reload()
    } catch (error: any) {
      toast({
        title: 'Error resetting historical limits',
        description: error.response?.data?.message || error.message,
        variant: 'destructive',
      })
      setResetHistoryDialogOpen(false)
      setSelectedDeviceId(null)
    }
  }

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-lg'>Registered Devices</CardTitle>
      </CardHeader>
      <CardContent>
          <div className='space-y-2'>
            {isPending && (
              <>
                {[1, 2, 3].map((i) => (
                  <Card key={i} className='border-0 shadow-none'>
                    <CardContent className='flex items-center p-3'>
                      <Skeleton className='h-6 w-6 rounded-full mr-3' />
                      <div className='flex-1'>
                        <div className='flex items-center justify-between'>
                          <Skeleton className='h-4 w-[120px]' />
                          <Skeleton className='h-4 w-[60px]' />
                        </div>
                        <div className='flex items-center space-x-2 mt-1'>
                          <Skeleton className='h-4 w-[180px]' />
                        </div>
                        <div className='flex items-center mt-1 space-x-3'>
                          <Skeleton className='h-3 w-[200px]' />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </>
            )}

            {error && (
              <div className='flex justify-center items-center h-full'>
                <div>Error: {error.message}</div>
              </div>
            )}

            {!isPending && !error && devices?.data?.length === 0 && (
              <div className='flex justify-center items-center h-full'>
                <div>No devices found</div>
              </div>
            )}

            {devices?.data?.map((device) => {
              const currentTier = getCurrentTier(device)
              const usagePercentage = getUsagePercentage(device)
              const onCooldown = isDeviceOnCooldown(device)
              const cooldownInfo = getCooldownDisplay(device)

              return (
                <Card key={device._id} className='border-0 shadow-none'>
                  <CardContent className='p-3'>
                    <div className='flex items-start justify-between'>
                      <div className='flex items-center'>
                        <Smartphone className='h-6 w-6 mr-3' />
                        <div className='flex-1'>
                          <div className='flex items-center gap-2 mb-1'>
                            <h3 className='font-semibold text-sm'>
                              {device.brand} {device.model}
                            </h3>
                            <Badge
                              variant={
                                device.enabled ? 'default' : 'secondary'
                              }
                              className='text-xs'
                            >
                              {device.enabled ? 'Enabled' : 'Disabled'}
                            </Badge>
                            {onCooldown && cooldownInfo && device.cooldown_reason !== 'tier_promotion' && (
                              <Badge
                                variant='destructive'
                                className='text-xs gap-1'
                              >
                                <Pause className='h-3 w-3' />
                                {cooldownInfo.message}
                              </Badge>
                            )}
                          </div>
                          <div className='flex items-center space-x-2 mb-2'>
                            <code className='relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-xs'>
                              {device._id}
                            </code>
                            <Button
                              variant='ghost'
                              size='icon'
                              className='h-6 w-6'
                              onClick={() => handleCopyId(device._id)}
                            >
                              <Copy className='h-3 w-3' />
                            </Button>
                          </div>
                          <div className='flex items-center space-x-2 mb-1'>
                            <Phone className='h-3 w-3 text-muted-foreground' />
                            <span className='text-xs text-muted-foreground'>
                              {formatPhoneNumberDisplay(device.phoneNumber)}
                            </span>
                          </div>
                          {(device.max_messages_per_cycle !== undefined || device.best_min_wait_seconds !== undefined) && (
                            <TooltipProvider>
                              <div className='flex items-center gap-2'>
                                <span className='text-xs text-muted-foreground'>Historical limits:</span>
                                <div className='flex items-center gap-3'>
                                  {device.max_messages_per_cycle !== undefined && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                                          <MessageSquare className='h-3 w-3' />
                                          <span>{device.max_messages_per_cycle}/day</span>
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Max daily messages (historical limit)</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                  {device.best_min_wait_seconds !== undefined && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                                          <Timer className='h-3 w-3' />
                                          <span>{formatTimeDelay(device.best_min_wait_seconds)}</span>
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p>Minimum send delay (historical limit)</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant='ghost'
                                      size='icon'
                                      className='h-5 w-5'
                                      onClick={() => {
                                        setSelectedDeviceId(device._id)
                                        setResetHistoryDialogOpen(true)
                                      }}
                                    >
                                      <RotateCcw className='h-3 w-3' />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Reset historical limits</p>
                                  </TooltipContent>
                                </Tooltip>
                                {isDeviceEligibleForAdvancement(device) && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant='ghost'
                                        size='icon'
                                        className='h-5 w-5'
                                        onClick={() => {
                                          setSelectedDeviceId(device._id)
                                          setAdvanceTierDialogOpen(true)
                                        }}
                                      >
                                        <ArrowUp className='h-3 w-3' />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Advance to highest tier</p>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </TooltipProvider>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Usage Plan Info */}
                    {device.usagePlan && currentTier && (
                      <div className='mt-3 space-y-2'>
                        <div className='flex items-center justify-between text-xs'>
                          <div className='flex items-center gap-2'>
                            <span className='text-muted-foreground'>Plan:</span>
                            <Select
                              value={device.usagePlan}
                              onValueChange={(planId) => {
                                if (planId !== device.usagePlan) {
                                  setSelectedDeviceId(device._id)
                                  setSelectedPlanId(planId)
                                  setChangePlanDialogOpen(true)
                                }
                              }}
                            >
                              <SelectTrigger className='h-6 w-auto text-xs border-0 bg-transparent hover:bg-muted'>
                                <SelectValue>
                                  {usagePlans?.data?.find(p => p._id === device.usagePlan)?.name || 'Unknown Plan'}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {usagePlans?.data?.map((plan) => (
                                  <SelectItem key={plan._id} value={plan._id} className='text-xs'>
                                    {plan.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <span className='text-muted-foreground'>•</span>
                            <span className='text-muted-foreground'>Tier {device.current_tier}</span>
                            <span className='text-muted-foreground'>•</span>
                            <div className='flex items-center gap-1'>
                              <Clock className='h-3 w-3' />
                              {formatTimeDelay(currentTier.min_wait_seconds)}
                            </div>
                          </div>
                        </div>

                        {/* Hide usage bar during tier progression cooldown */}
                        {!(device.cooldown_reason === 'tier_promotion') && (
                          <div className='space-y-1'>
                            <div className='flex items-center justify-between text-xs'>
                              <span className='text-muted-foreground'>
                                Usage (Last {device.usage_window_minutes ? Math.round(device.usage_window_minutes / 60) : 24}h) ({device.messages_sent_today}/{currentTier.messages_per_cycle})
                              </span>
                              <span className='text-muted-foreground'>
                                {Math.round(usagePercentage)}%
                              </span>
                            </div>
                            <Progress
                              value={usagePercentage}
                              className='h-2'
                              indicatorClassName={
                                usagePercentage >= 100
                                  ? 'bg-destructive'
                                  : usagePercentage >= 80
                                  ? 'bg-yellow-500'
                                  : 'bg-primary'
                              }
                            />
                          </div>
                        )}

                        {/* Show "Warming up to Tier X" message during tier progression cooldown */}
                        {device.cooldown_reason === 'tier_promotion' && cooldownInfo && (
                          <div className='flex items-center gap-3 text-xs'>
                            <Badge
                              variant='secondary'
                              className='text-xs gap-1'
                            >
                              <Pause className='h-3 w-3' />
                              {cooldownInfo.message}
                            </Badge>
                            <div className='flex items-center gap-1 text-muted-foreground'>
                              <Clock className='h-3 w-3' />
                              <span className='font-medium text-foreground'>
                                {formatTimeRemaining(device.cooldown_end_time || device.estimated_cooldown_end || '')}
                              </span>
                              <span>remaining</span>
                            </div>
                          </div>
                        )}

                        {onCooldown && cooldownInfo && cooldownInfo.timeDisplay && device.cooldown_reason !== 'tier_promotion' && (
                          <div className='flex items-center gap-2 text-xs'>
                            <div className='flex items-center gap-1 text-muted-foreground'>
                              <Clock className='h-3 w-3' />
                              <span className='font-medium text-foreground'>
                                {formatTimeRemaining(device.cooldown_end_time || device.estimated_cooldown_end || '')}
                              </span>
                              <span>remaining</span>
                            </div>
                            <span className='text-muted-foreground'>•</span>
                            <span className='text-muted-foreground'>
                              Cooldown ends ~{cooldownInfo.timeDisplay}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {!device.usagePlan && (
                      <div className='mt-3 text-xs text-muted-foreground'>
                        No usage plan assigned
                      </div>
                    )}

                    <div className='flex items-center mt-3 space-x-3 text-xs text-muted-foreground'>
                      <div className='flex items-center'>
                        <Battery className='h-3 w-3 mr-1' />
                        unknown
                      </div>
                      <div className='flex items-center'>
                        <Signal className='h-3 w-3 mr-1' />-
                      </div>
                      <div>
                        Registered: {new Date(device.createdAt).toLocaleString('en-US', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
      </CardContent>

      {/* Advance Tier Confirmation Dialog */}
      <AlertDialog open={advanceTierDialogOpen} onOpenChange={setAdvanceTierDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Advance to Highest Tier</AlertDialogTitle>
            <AlertDialogDescription>
              This will advance the device to the highest tier it qualifies for based on its historical limits.
              The device will be immediately upgraded without any cooldown period. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedDeviceId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAdvanceTier}>Advance Tier</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Historical Limits Confirmation Dialog */}
      <AlertDialog open={resetHistoryDialogOpen} onOpenChange={setResetHistoryDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Historical Limits</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset the device's historical limits. If the device has a usage plan,
              the limits will be set to the current tier's values. If the device has no usage plan,
              both limits will be set to zero. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedDeviceId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetHistory}>Reset Limits</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change Plan Confirmation Dialog */}
      <AlertDialog open={changePlanDialogOpen} onOpenChange={setChangePlanDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Usage Plan</AlertDialogTitle>
            <AlertDialogDescription>
              This will change the device's usage plan to{' '}
              <strong>{usagePlans?.data?.find(p => p._id === selectedPlanId)?.name}</strong>.
              The device will start at tier 1. You can use the "Advance to highest tier" button
              to immediately advance based on historical limits. Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setSelectedDeviceId(null)
              setSelectedPlanId(null)
            }}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePlanChange}>Change Plan</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
