'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Edit, Trash2, Star, Clock, MessageCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { CreateUsagePlanDialog } from './create-usage-plan-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface UsagePlanTier {
  tier: number
  min_wait_seconds: number
  messages_per_cycle: number
}

interface UsagePlan {
  _id: string
  name: string
  description?: string
  tiers: UsagePlanTier[]
  isDefault: boolean
  isActive: boolean
  isTemplate?: boolean
  createdAt: string
}

export default function UsagePlans() {
  console.log('🔧 UsagePlans component rendering...')

  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<UsagePlan | null>(null)
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set())

  const {
    data: usagePlans,
    isPending,
    error,
  } = useQuery<{ data: UsagePlan[] }>({
    queryKey: ['usage-plans'],
    queryFn: () => {
      const endpoint = ApiEndpoints.gateway.getUserUsagePlans()
      console.log('🔧 UsagePlans: Making API call to:', endpoint)
      console.log('🔧 UsagePlans: NEXT_PUBLIC_API_BASE_URL env var:', process.env.NEXT_PUBLIC_API_BASE_URL)
      console.log('🔧 UsagePlans: Full URL will be:', `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api/v1'}${endpoint}`)

      return httpBrowserClient
        .get(endpoint)
        .then((res) => {
          console.log('🔧 UsagePlans: API success response:', res)
          console.log('🔧 UsagePlans: API response data:', res.data)
          return res.data
        })
        .catch((err) => {
          console.error('🔧 UsagePlans: API error details:', err)
          console.error('🔧 UsagePlans: Error response:', err.response)
          console.error('🔧 UsagePlans: Error status:', err.response?.status)
          console.error('🔧 UsagePlans: Error message:', err.message)
          throw err
        })
    },
    retry: false, // Disable retry for debugging
  })

  console.log('🔧 Usage plans query state:', { isPending, error, data: usagePlans })
  console.log('🔧 Usage plans data details:', usagePlans?.data)
  console.log('🔧 Usage plans length:', usagePlans?.data?.length)

  const deleteUsagePlanMutation = useMutation({
    mutationFn: (planId: string) =>
      httpBrowserClient.delete(ApiEndpoints.gateway.deleteUsagePlan(planId)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usage-plans'] })
      toast({
        title: 'Usage plan deleted successfully',
      })
    },
    onError: (error: any) => {
      toast({
        title: 'Error deleting usage plan',
        description: error.response?.data?.message || error.message,
        variant: 'destructive',
      })
    },
  })

  const formatTimeDelay = (seconds: number) => {
    if (seconds === 0) return 'No delay'
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (remainingSeconds === 0) return `${minutes}m`
    return `${minutes}m ${remainingSeconds}s`
  }

  const handleCreateSuccess = () => {
    setCreateDialogOpen(false)
    queryClient.invalidateQueries({ queryKey: ['usage-plans'] })
  }

  const handleEditSuccess = () => {
    setEditingPlan(null)
    queryClient.invalidateQueries({ queryKey: ['usage-plans'] })
  }

  const handleDelete = (planId: string) => {
    deleteUsagePlanMutation.mutate(planId)
  }

  const togglePlanExpansion = (planId: string) => {
    const newExpanded = new Set(expandedPlans)
    if (newExpanded.has(planId)) {
      newExpanded.delete(planId)
    } else {
      newExpanded.add(planId)
    }
    setExpandedPlans(newExpanded)
  }

  if (error) {
    console.error('🔧 Usage plans error rendering:', error)
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Manage Usage Plans</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground">
            Error loading usage plans: {(error as any).message}
          </div>
        </CardContent>
      </Card>
    )
  }

  console.log('🔧 UsagePlans rendering Card component...')

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Manage Usage Plans</CardTitle>
          <Button
            onClick={() => setCreateDialogOpen(true)}
            size="sm"
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Plan
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Create and manage usage plans with different tiers and limits for your devices
        </p>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <div key={i} className="border rounded-lg p-4 animate-pulse">
                <div className="h-4 bg-muted rounded w-1/3 mb-2" />
                <div className="h-3 bg-muted rounded w-1/2 mb-3" />
                <div className="space-y-2">
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : usagePlans?.data?.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-muted-foreground mb-4">
              No usage plans created yet
            </div>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Plan
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {usagePlans?.data?.map((plan) => (
              <div key={plan._id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{plan.name}</h3>
                    {plan.isDefault && (
                      <Badge variant="secondary" className="gap-1">
                        <Star className="h-3 w-3" />
                        Default
                      </Badge>
                    )}
                    {plan.isTemplate && (
                      <Badge variant="outline" className="text-xs">
                        Template
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingPlan(plan)}
                      disabled={plan.isTemplate}
                      title={plan.isTemplate ? "Template plans cannot be edited" : "Edit plan"}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={plan.isTemplate}
                          title={plan.isTemplate ? "Template plans cannot be deleted" : "Delete plan"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Usage Plan</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{plan.name}"? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(plan._id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                {plan.description && (
                  <p className="text-sm text-muted-foreground mb-3">
                    {plan.description}
                  </p>
                )}

                <div className="space-y-2">
                  <button
                    onClick={() => togglePlanExpansion(plan._id)}
                    className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
                  >
                    {expandedPlans.has(plan._id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Tiers ({plan.tiers.length})
                  </button>

                  {expandedPlans.has(plan._id) && (
                    <div className="grid gap-2">
                      {plan.tiers.map((tier) => (
                        <div key={tier.tier} className="flex items-center justify-between bg-muted/50 p-3 rounded text-sm">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="min-w-[60px] justify-center">
                              Tier {tier.tier}
                            </Badge>
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {formatTimeDelay(tier.min_wait_seconds)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <MessageCircle className="h-3 w-3" />
                            {tier.messages_per_cycle} daily limit
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <CreateUsagePlanDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={handleCreateSuccess}
        editingPlan={null}
        existingPlanNames={usagePlans?.data?.map(plan => plan.name) || []}
      />

      {editingPlan && (
        <CreateUsagePlanDialog
          open={true}
          onOpenChange={() => setEditingPlan(null)}
          onSuccess={handleEditSuccess}
          editingPlan={editingPlan}
          existingPlanNames={usagePlans?.data?.map(plan => plan.name) || []}
        />
      )}
    </Card>
  )
}