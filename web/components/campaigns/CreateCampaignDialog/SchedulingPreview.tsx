import { useMemo, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Clock, Users, Zap, RefreshCw, MessageSquare } from 'lucide-react'
import { CreateCampaignData, SchedulingPreview } from '@/components/campaigns/types/campaign.types'
import { MessageToSchedule, ExistingMessage, createSchedulingContext, optimizeMessageSchedule } from '../utils/message-scheduler'

// Device interface matching the CreateCampaignDialog - using usage plan system
interface Device {
  _id: string
  brand?: string
  model?: string
  enabled: boolean
  current_tier?: number
  messages_sent_today?: number
  messages_sent_this_hour?: number
  hourly_counter_reset?: Date
  daily_counter_reset?: Date
  last_tier_upgrade?: Date
  plan_type?: number
  usagePlan?: string // Usage plan ID
}

// Usage plan interfaces
interface UsagePlanTier {
  tier: number
  timeDelayBetweenMessages: number // in seconds
  dailyLimit: number
}

interface UsagePlan {
  _id: string
  name: string
  description?: string
  tiers: UsagePlanTier[]
  isDefault: boolean
  isActive: boolean
}

interface SchedulingPreviewProps {
  campaignData: CreateCampaignData
  contacts: any[]
  templates: any[]
  devices: Device[]
  usagePlans: UsagePlan[]
  uniqueContactCount: number
  onPreviewUpdate?: (preview: SchedulingPreview) => void
}

export function SchedulingPreview({
  campaignData,
  contacts,
  templates,
  devices,
  usagePlans,
  uniqueContactCount,
  onPreviewUpdate
}: SchedulingPreviewProps) {
  const [preview, setPreview] = useState<SchedulingPreview | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  // Helper functions for usage plan management
  const getCurrentTier = (device: Device): UsagePlanTier | null => {
    if (!device.usagePlan || !usagePlans) return null
    const plan = usagePlans.find(p => p._id === device.usagePlan)
    if (!plan) return null
    return plan.tiers.find(t => t.tier === (device.current_tier || 1)) || plan.tiers[0]
  }

  // Calculate total messages based on unique contacts from Details tab
  const totalMessages = useMemo(() => {
    // Total messages = unique contacts from Details tab × selected templates
    return uniqueContactCount * campaignData.selectedTemplates.length
  }, [uniqueContactCount, campaignData.selectedTemplates.length])

  // Generate scheduling preview
  const generatePreview = async () => {
    if (totalMessages === 0 || campaignData.sendDevices.length === 0) {
      setPreview(null)
      return
    }

    setIsGenerating(true)

    try {
      // Create mock messages based on uniqueContactCount and templates
      const newMessages: MessageToSchedule[] = []
      let messageId = 1

      // Generate messages for each unique contact × each template
      for (let contactIndex = 0; contactIndex < uniqueContactCount; contactIndex++) {
        for (const templateId of campaignData.selectedTemplates) {
          const template = templates.find(t => t._id === templateId)

          if (template) {
            newMessages.push({
              id: `msg-${messageId++}`,
              content: template.content,
              recipient: `+1555${String(1000 + contactIndex).padStart(4, '0')}`, // Placeholder phone numbers
              campaignId: 'preview-campaign',
              campaignName: campaignData.name || 'New Campaign',
              priority: 1
            })
          }
        }
      }

      // Get enabled devices that are selected
      const selectedDevices = devices.filter(device =>
        device.enabled && campaignData.sendDevices.includes(device._id)
      )

      // Create scheduling context
      const context = createSchedulingContext(
        selectedDevices,
        newMessages,
        [], // No existing messages for preview
        campaignData
      )

      // Optimize schedule
      const optimizedSchedule = optimizeMessageSchedule(context)

      // Create preview data
      const schedulingPreview: SchedulingPreview = {
        totalMessages: optimizedSchedule.totalMessages,
        estimatedCompletionTime: optimizedSchedule.estimatedCompletionTime,
        campaignSegments: optimizedSchedule.campaignSegments,
        deviceUtilization: selectedDevices.map(device => {
          const currentTier = getCurrentTier(device)
          const hourlyCapacity = currentTier && currentTier.timeDelayBetweenMessages > 0
            ? Math.floor(3600 / currentTier.timeDelayBetweenMessages)
            : 0
          const dailyCapacity = currentTier?.dailyLimit || 0

          return {
            deviceId: device._id,
            deviceName: `${device.brand || 'Unknown'} ${device.model || 'Device'}`,
            currentTier: device.current_tier || 1,
            hourlyCapacity,
            dailyCapacity,
            scheduledMessages: optimizedSchedule.schedules
              .filter(schedule => schedule.deviceId === device._id)
              .reduce((total, schedule) => total + schedule.messages.length, 0)
          }
        })
      }

      setPreview(schedulingPreview)
      onPreviewUpdate?.(schedulingPreview)

    } catch (error) {
      console.error('Error generating scheduling preview:', error)
    } finally {
      setIsGenerating(false)
    }
  }

  // Auto-generate preview when key data changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      generatePreview()
    }, 500) // Debounce to avoid excessive calculations

    return () => clearTimeout(timeoutId)
  }, [
    totalMessages,
    campaignData.sendDevices,
    campaignData.scheduleType,
    campaignData.campaignStartDate,
    campaignData.campaignEndDate,
    campaignData.sendingWindows,
    campaignData.weekdayWindows,
    campaignData.weekdayEnabled
  ])

  if (totalMessages === 0) {
    const hasContacts = uniqueContactCount > 0
    const hasTemplates = campaignData.selectedTemplates.length > 0

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4" />
            Scheduling Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-sm text-muted-foreground py-6">
            <MessageSquare className="h-6 w-6 mx-auto mb-2 opacity-50" />
            {!hasContacts && !hasTemplates && (
              <p>Select contacts and templates to see scheduling preview</p>
            )}
            {hasContacts && !hasTemplates && (
              <div>
                <p className="font-medium text-foreground">{uniqueContactCount} unique contacts selected</p>
                <p>Select templates to see scheduling preview</p>
              </div>
            )}
            {!hasContacts && hasTemplates && (
              <div>
                <p className="font-medium text-foreground">{campaignData.selectedTemplates.length} templates selected</p>
                <p>Select contacts to see scheduling preview</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (campaignData.sendDevices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4" />
            Scheduling Preview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-sm text-muted-foreground py-8">
            <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Select devices to see scheduling preview</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Scheduling Preview
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={generatePreview}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isGenerating ? (
          <div className="text-center text-sm text-muted-foreground py-8">
            <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin" />
            <p>Optimizing message schedule...</p>
          </div>
        ) : preview ? (
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Total Messages</p>
                <p className="text-lg font-semibold">{preview.totalMessages.toLocaleString()}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Est. Completion</p>
                <p className="text-sm font-medium">
                  {preview.estimatedCompletionTime.toLocaleString('en-US', {
                    timeZone: campaignData.timezone,
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                  })}
                </p>
              </div>
            </div>

            {/* Campaign Segments */}
            {preview.campaignSegments.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Campaign Segments</p>
                <div className="space-y-1">
                  {preview.campaignSegments.map((segment, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs">
                      <div>
                        <span className="font-medium">{segment.messageCount} messages</span>
                        <span className="text-muted-foreground ml-2">
                          {segment.startTime.toLocaleString('en-US', {
                            timeZone: campaignData.timezone,
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {segment.deviceIds.length} devices
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Device Utilization */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Device Utilization</p>
              <div className="space-y-1">
                {preview.deviceUtilization.map((device, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded text-xs">
                    <div>
                      <span className="font-medium">{device.deviceName}</span>
                      <div className="text-muted-foreground">
                        Tier {device.currentTier} • {device.hourlyCapacity}/hr • {device.dailyCapacity}/day
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{device.scheduledMessages} msgs</div>
                      <div className="text-muted-foreground">
                        {device.scheduledMessages > 0 && device.dailyCapacity > 0
                          ? `${Math.round((device.scheduledMessages / device.dailyCapacity) * 100)}% capacity`
                          : 'No messages'
                        }
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Performance Indicator */}
            <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded">
              <Zap className="h-3 w-3 text-blue-600" />
              <span className="text-xs text-blue-700">
                Optimized for fastest delivery within device constraints
              </span>
            </div>
          </div>
        ) : (
          <div className="text-center text-sm text-muted-foreground py-8">
            <p>Unable to generate preview</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}