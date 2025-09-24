'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Edit, Trash2, Star, Clock, MessageCircle } from 'lucide-react'
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
  timeDelayBetweenMessages: number
  dailyLimit: number
}

interface UsagePlan {
  _id: string
  name: string
  description?: string
  tiers: UsagePlanTier[]
  isDefault: boolean
  isActive: boolean
  createdAt: string
}

export default function UsagePlans() {
  console.log('🔧 UsagePlans component rendering...')

  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<UsagePlan | null>(null)

  const {
    data: usagePlans,
    isPending,
    error,
  } = useQuery<{ data: UsagePlan[] }>({
    queryKey: ['usage-plans'],
    queryFn: () => {
      console.log('🔧 Making API call to:', ApiEndpoints.gateway.getUserUsagePlans())
      return httpBrowserClient
        .get(ApiEndpoints.gateway.getUserUsagePlans())
        .then((res) => {
          console.log('🔧 Usage plans API response:', res.data)
          return res.data
        })
        .catch((err) => {
          console.error('🔧 Usage plans API error:', err)
          throw err
        })
    },
  })

  console.log('🔧 Usage plans query state:', { isPending, error, data: usagePlans })

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
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingPlan(plan)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm">
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
                  <h4 className="text-sm font-medium">Tiers ({plan.tiers.length})</h4>
                  <div className="grid gap-2">
                    {plan.tiers.map((tier) => (
                      <div key={tier.tier} className="flex items-center justify-between bg-muted/50 p-3 rounded text-sm">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="min-w-[60px] justify-center">
                            Tier {tier.tier}
                          </Badge>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatTimeDelay(tier.timeDelayBetweenMessages)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <MessageCircle className="h-3 w-3" />
                          {tier.dailyLimit} daily limit
                        </div>
                      </div>
                    ))}
                  </div>
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
      />

      {editingPlan && (
        <CreateUsagePlanDialog
          open={true}
          onOpenChange={() => setEditingPlan(null)}
          onSuccess={handleEditSuccess}
          editingPlan={editingPlan}
        />
      )}
    </Card>
  )
}