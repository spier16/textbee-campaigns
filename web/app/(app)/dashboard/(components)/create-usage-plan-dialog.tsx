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
import { Switch } from '@/components/ui/switch'
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { useMutation } from '@tanstack/react-query'

const tierSchema = z.object({
  tier: z.number().min(1),
  timeDelayBetweenMessages: z.number().min(0),
  dailyLimit: z.number().min(1),
})

const usagePlanSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  tiers: z.array(tierSchema).min(1, 'At least one tier is required'),
  isDefault: z.boolean().default(false),
})

type UsagePlanForm = z.infer<typeof usagePlanSchema>

interface UsagePlan {
  _id: string
  name: string
  description?: string
  tiers: {
    tier: number
    timeDelayBetweenMessages: number
    dailyLimit: number
  }[]
  isDefault: boolean
  isActive: boolean
}

interface CreateUsagePlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  editingPlan?: UsagePlan | null
}

export function CreateUsagePlanDialog({
  open,
  onOpenChange,
  onSuccess,
  editingPlan,
}: CreateUsagePlanDialogProps) {
  const { toast } = useToast()
  const isEditing = !!editingPlan

  const form = useForm<UsagePlanForm>({
    resolver: zodResolver(usagePlanSchema),
    defaultValues: editingPlan
      ? {
          name: editingPlan.name,
          description: editingPlan.description || '',
          tiers: editingPlan.tiers.map((tier) => ({
            tier: tier.tier,
            timeDelayBetweenMessages: tier.timeDelayBetweenMessages,
            dailyLimit: tier.dailyLimit,
          })),
          isDefault: editingPlan.isDefault,
        }
      : {
          name: '',
          description: '',
          tiers: [
            { tier: 1, timeDelayBetweenMessages: 2, dailyLimit: 50 },
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
      timeDelayBetweenMessages: 1,
      dailyLimit: 100,
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
                name="isDefault"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Default Plan</FormLabel>
                      <div className="text-sm text-muted-foreground">
                        Set as the default plan for new devices
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
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
                        name={`tiers.${index}.timeDelayBetweenMessages`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Time Delay (seconds)</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="number"
                                min="0"
                                onChange={(e) =>
                                  field.onChange(parseInt(e.target.value) || 0)
                                }
                              />
                            </FormControl>
                            <div className="text-xs text-muted-foreground">
                              {formatTimeDelay(field.value)}
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`tiers.${index}.dailyLimit`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Daily Message Limit</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type="number"
                                min="1"
                                onChange={(e) =>
                                  field.onChange(parseInt(e.target.value) || 1)
                                }
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
                  <strong>How tiers work:</strong> Devices start on Tier 1. When a device exceeds its daily limit,
                  it moves to the next tier (if available) or goes on cooldown. After 24 hours with zero usage,
                  the device can advance to the next tier.
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