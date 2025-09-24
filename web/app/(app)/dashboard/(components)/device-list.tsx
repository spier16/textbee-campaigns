'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Smartphone, Battery, Signal, Copy, Settings, Clock, Pause } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface UsagePlan {
  _id: string
  name: string
  tiers: {
    tier: number
    timeDelayBetweenMessages: number
    dailyLimit: number
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
  daily_counter_reset?: string
  is_on_cooldown?: boolean
  cooldown_until?: string
  usagePlan?: string // Now just the ID
}

export default function DeviceList() {
  const { toast } = useToast()
  const [assigningPlan, setAssigningPlan] = useState<string | null>(null)

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
    return Math.min((device.messages_sent_today / tier.dailyLimit) * 100, 100)
  }

  const isDeviceOnCooldown = (device: Device) => {
    if (!device.is_on_cooldown || !device.cooldown_until) return false
    return new Date() < new Date(device.cooldown_until)
  }

  const formatTimeDelay = (seconds: number) => {
    if (seconds === 0) return 'No delay'
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (remainingSeconds === 0) return `${minutes}m`
    return `${minutes}m ${remainingSeconds}s`
  }

  const handleAssignPlan = async (deviceId: string, planId: string) => {
    try {
      await httpBrowserClient.patch(
        ApiEndpoints.gateway.assignUsagePlan(deviceId),
        { usagePlanId: planId }
      )
      toast({
        title: 'Usage plan assigned successfully',
      })
      // Refetch devices to show updated data
      window.location.reload()
    } catch (error: any) {
      toast({
        title: 'Error assigning usage plan',
        description: error.response?.data?.message || error.message,
        variant: 'destructive',
      })
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
                            {onCooldown && (
                              <Badge
                                variant="destructive"
                                className='text-xs gap-1'
                              >
                                <Pause className='h-3 w-3' />
                                Cooldown
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
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='ghost' size='sm' className='h-8 w-8 p-0'>
                            <Settings className='h-4 w-4' />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          {usagePlans?.data && usagePlans.data.length > 0 ? (
                            <>
                              {usagePlans.data.map((plan) => (
                                <DropdownMenuItem
                                  key={plan._id}
                                  onClick={() => handleAssignPlan(device._id, plan._id)}
                                  disabled={device.usagePlan === plan._id}
                                >
                                  {device.usagePlan === plan._id ? '✓ ' : ''}
                                  Assign "{plan.name}"
                                </DropdownMenuItem>
                              ))}
                            </>
                          ) : (
                            <DropdownMenuItem disabled>
                              No usage plans available
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Usage Plan Info */}
                    {device.usagePlan && currentTier && (
                      <div className='mt-3 space-y-2'>
                        <div className='flex items-center justify-between text-xs'>
                          <div className='flex items-center gap-2'>
                            <span className='text-muted-foreground'>Plan:</span>
                            <Badge variant="outline" className='text-xs'>
                              {usagePlans?.data?.find(p => p._id === device.usagePlan)?.name || 'Unknown Plan'}
                            </Badge>
                            <span className='text-muted-foreground'>•</span>
                            <span className='text-muted-foreground'>Tier {device.current_tier}</span>
                            <span className='text-muted-foreground'>•</span>
                            <div className='flex items-center gap-1'>
                              <Clock className='h-3 w-3' />
                              {formatTimeDelay(currentTier.timeDelayBetweenMessages)}
                            </div>
                          </div>
                        </div>

                        <div className='space-y-1'>
                          <div className='flex items-center justify-between text-xs'>
                            <span className='text-muted-foreground'>
                              Daily Usage ({device.messages_sent_today}/{currentTier.dailyLimit})
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

                        {onCooldown && device.cooldown_until && (
                          <div className='text-xs text-muted-foreground'>
                            Cooldown until: {new Date(device.cooldown_until).toLocaleString()}
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
    </Card>
  )
}
