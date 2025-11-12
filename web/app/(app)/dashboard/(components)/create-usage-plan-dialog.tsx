'use client'

import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, ArrowUp, ArrowDown, Copy } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { useMutation, useQuery } from '@tanstack/react-query'

interface PlanTemplate {
  _id?: string
  name: string
  description: string
  maxDailyLimit: number
  tierPromotionCooldownHours?: number
  tiers: {
    tier: number
    min_wait_seconds: number
    messages_per_cycle: number
  }[]
}

const tierSchema = z.object({
  tier: z.number().min(1),
  min_wait_seconds: z.union([z.number(), z.string()])
    .refine((val) => {
      if (typeof val === 'string' && val.trim() === '') {
        return false
      }
      return true
    }, { message: 'Time delay is required' })
    .transform((val) => {
      if (typeof val === 'string') {
        const num = parseInt(val)
        return isNaN(num) ? 30 : num
      }
      return val
    })
    .refine((val) => val >= 30, { message: 'Time delay must be at least 30 seconds' }),
  messages_per_cycle: z.union([z.number(), z.string()])
    .refine((val) => {
      if (typeof val === 'string' && val.trim() === '') {
        return false
      }
      return true
    }, { message: 'Daily limit is required' })
    .transform((val) => {
      if (typeof val === 'string') {
        const num = parseInt(val)
        return isNaN(num) || num < 1 ? 1 : num
      }
      return val < 1 ? 1 : val
    })
    .refine((val) => val >= 1, { message: 'Daily limit must be at least 1' }),
})

const createUsagePlanSchema = (existingNames: string[] = [], currentPlanName?: string) => z.object({
  name: z.string()
    .min(1, 'Name is required')
    .refine((name) => {
      const normalizedName = name.toLowerCase().trim()
      const normalizedExisting = existingNames.map(n => n.toLowerCase().trim())
      const currentNormalized = currentPlanName?.toLowerCase().trim()

      // Allow current name when editing
      if (currentNormalized && normalizedName === currentNormalized) {
        return true
      }

      // Check if name already exists
      return !normalizedExisting.includes(normalizedName)
    }, 'A plan with this name already exists'),
  description: z.string().optional(),
  tierPromotionCooldownHours: z.union([z.number(), z.string()])
    .refine((val) => {
      if (typeof val === 'string' && val.trim() === '') {
        return false
      }
      return true
    }, { message: 'Cooldown is required' })
    .transform((val) => {
      if (typeof val === 'string') {
        const num = parseInt(val)
        return isNaN(num) || num < 1 ? 24 : num
      }
      return val < 1 ? 24 : val
    })
    .refine((val) => val >= 1, { message: 'Cooldown must be at least 1 hour' }),
  tiers: z.array(tierSchema).min(1, 'At least one tier is required'),
  isDefault: z.boolean().default(false),
})

type UsagePlanForm = z.infer<ReturnType<typeof createUsagePlanSchema>>

interface UsagePlan {
  _id: string
  name: string
  description?: string
  tierPromotionCooldownHours?: number
  tiers: {
    tier: number
    min_wait_seconds: number
    messages_per_cycle: number
  }[]
  isDefault: boolean
  isActive: boolean
}

interface CreateUsagePlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  editingPlan?: UsagePlan | null
  existingPlanNames?: string[]
}

export function CreateUsagePlanDialog({
  open,
  onOpenChange,
  onSuccess,
  editingPlan,
  existingPlanNames = [],
}: CreateUsagePlanDialogProps) {
  const { toast } = useToast()
  const isEditing = !!editingPlan
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')

  // Fetch templates from API
  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['usage-plan-templates'],
    queryFn: async () => {
      const response = await httpBrowserClient.get(
        ApiEndpoints.gateway.getUsagePlanTemplates()
      )
      return response.data.data as PlanTemplate[]
    },
    enabled: open && !isEditing, // Only fetch when dialog is open and not editing
  })

  const planTemplates = templatesData || []

  const usagePlanSchema = createUsagePlanSchema(existingPlanNames, editingPlan?.name)

  const form = useForm<UsagePlanForm>({
    resolver: zodResolver(usagePlanSchema),
    defaultValues: editingPlan
      ? {
          name: editingPlan.name,
          description: editingPlan.description || '',
          tierPromotionCooldownHours: editingPlan.tierPromotionCooldownHours || 24,
          tiers: editingPlan.tiers.map((tier) => ({
            tier: tier.tier,
            min_wait_seconds: tier.min_wait_seconds,
            messages_per_cycle: tier.messages_per_cycle,
          })),
          isDefault: editingPlan.isDefault,
        }
      : {
          name: '',
          description: '',
          tierPromotionCooldownHours: 24,
          tiers: [
            { tier: 1, min_wait_seconds: 30, messages_per_cycle: 50 },
          ],
          isDefault: false,
        },
  })

  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: 'tiers',
  })

  const createMutation = useMutation({
    mutationFn: (data: UsagePlanForm) =>
      httpBrowserClient.post(ApiEndpoints.gateway.createUsagePlan(), data),
    onSuccess: () => {
      toast({
        title: 'Usage plan created successfully',
      })
      onSuccess()
      form.reset()
    },
    onError: (error: any) => {
      toast({
        title: 'Error creating usage plan',
        description: error.response?.data?.message || error.message,
        variant: 'destructive',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: UsagePlanForm) =>
      httpBrowserClient.patch(
        ApiEndpoints.gateway.updateUsagePlan(editingPlan!._id),
        data
      ),
    onSuccess: () => {
      toast({
        title: 'Usage plan updated successfully',
      })
      onSuccess()
    },
    onError: (error: any) => {
      toast({
        title: 'Error updating usage plan',
        description: error.response?.data?.message || error.message,
        variant: 'destructive',
      })
    },
  })

  const onSubmit = (data: UsagePlanForm) => {
    // Normalize tier numbers to be sequential starting from 1
    const normalizedTiers = data.tiers.map((tier, index) => ({
      ...tier,
      tier: index + 1,
    }))

    const submissionData = {
      ...data,
      tiers: normalizedTiers,
    }

    if (isEditing) {
      updateMutation.mutate(submissionData)
    } else {
      createMutation.mutate(submissionData)
    }
  }

  const addTier = () => {
    const nextTier = fields.length + 1
    append({
      tier: nextTier,
      min_wait_seconds: 30,
      messages_per_cycle: 100,
    })
  }

  const removeTier = (index: number) => {
    if (fields.length > 1) {
      remove(index)
    }
  }

  const moveTier = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index > 0) {
      move(index, index - 1)
    } else if (direction === 'down' && index < fields.length - 1) {
      move(index, index + 1)
    }
  }

  const applyTemplate = (templateName: string) => {
    const template = planTemplates.find(t => t.name === templateName)
    if (!template) return

    // Reset form fields array to remove existing tiers
    form.setValue('tiers', [])

    // Set form values
    form.setValue('name', template.name)
    form.setValue('description', template.description || '')
    form.setValue('tierPromotionCooldownHours', template.tierPromotionCooldownHours || 24)
    form.setValue('tiers', template.tiers)
    form.setValue('isDefault', false)

    toast({
      title: 'Template applied',
      description: `Applied "${template.name}" template with ${template.tiers.length} tiers`,
    })
  }

  const formatTimeDelay = (seconds: number) => {
    if (seconds === 0) return 'No delay'
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (remainingSeconds === 0) return `${minutes}m`
    return `${minutes}m ${remainingSeconds}s`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Usage Plan' : 'Create Usage Plan'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update your usage plan settings and tiers.'
              : 'Create a new usage plan with different tiers and limits for your devices.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {!isEditing && (
              <div className="bg-muted/50 p-4 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium">Quick Start Templates</h3>
                  <Badge variant="secondary">Pre-configured</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Choose from our optimized templates or create a custom plan from scratch.
                </p>
                <div className="space-y-3">
                  <Select
                    value={selectedTemplate}
                    onValueChange={setSelectedTemplate}
                    disabled={templatesLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={
                        templatesLoading
                          ? "Loading templates..."
                          : "Select a template (optional)"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {planTemplates.map((template) => (
                        <SelectItem key={template.name} value={template.name}>
                          <div className="flex flex-col items-start">
                            <span className="font-medium">{template.name}</span>
                            <span className="text-sm text-muted-foreground">
                              {template.description} • {template.maxDailyLimit} texts/day
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedTemplate && (
                    <Button
                      type="button"
                      onClick={() => applyTemplate(selectedTemplate)}
                      className="w-full gap-2"
                    >
                      <Copy className="h-4 w-4" />
                      Apply "{selectedTemplate}" Template
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plan Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Enter plan name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Describe this usage plan..."
                        rows={2}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tierPromotionCooldownHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tier Promotion Cooldown (hours)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min="1"
                        value={field.value === undefined ? '' : String(field.value)}
                        onChange={(e) => {
                          const v = e.target.value
                          field.onChange(v === '' ? '' : Number(v))
                        }}
                        onWheel={(e) => e.currentTarget.blur()}
                      />
                    </FormControl>
                    <div className="text-xs text-muted-foreground">
                      How long devices wait after tier promotion before sending more campaign messages (default: 24 hours)
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">Usage Tiers</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addTier}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Tier
                </Button>
              </div>

              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={field.id} className="border rounded-lg p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="gap-1">
                        Tier {index + 1}
                      </Badge>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => moveTier(index, 'up')}
                          disabled={index === 0}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => moveTier(index, 'down')}
                          disabled={index === fields.length - 1}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTier(index)}
                          disabled={fields.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name={`tiers.${index}.min_wait_seconds`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Minimum Time Delay (seconds)</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="number"
                                min="30"
                                value={field.value === undefined ? '' : String(field.value)}
                                onChange={(e) => {
                                  const v = e.target.value
                                  field.onChange(v === '' ? '' : Number(v))
                                }}
                                onWheel={(e) => e.currentTarget.blur()}
                              />
                            </FormControl>
                            <div className="text-xs">
                              {typeof field.value === 'number' && field.value < 30 ? (
                                <span className="text-red-500 font-medium">Time delay must be at least 30 seconds</span>
                              ) : (
                                <span className="text-muted-foreground">
                                  {typeof field.value === 'number' ? formatTimeDelay(field.value) : 'Enter seconds'}
                                </span>
                              )}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`tiers.${index}.messages_per_cycle`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Daily Message Limit</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="number"
                                min={1}
                                value={field.value === undefined ? '' : String(field.value)}
                                onChange={(e) => {
                                  const v = e.target.value
                                  field.onChange(v === '' ? '' : Number(v))
                                }}
                                onWheel={(e) => e.currentTarget.blur()}
                                inputMode="numeric"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  <strong>How tiers work:</strong> Devices start on Tier 1. When a device exceeds its tier's daily limit, it automatically promotes to the next tier (if available) and enters a cooldown period. During cooldown, the device cannot send campaign messages. After cooldown ends, the device can use its new tier's higher limits. When a device at the maximum tier exceeds its limit, it goes on cooldown until the rolling usage window allows more messages. Messages sent manually (not through campaigns) do not count against daily limits.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {createMutation.isPending || updateMutation.isPending
                  ? 'Saving...'
                  : isEditing
                  ? 'Update Plan'
                  : 'Create Plan'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}