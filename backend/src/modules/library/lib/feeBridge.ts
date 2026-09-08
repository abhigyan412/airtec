import { supabase } from '../../../shared/db/client'
import { discountForLine, money, ApplicableDiscount } from '../../../shared/utils/feeMoney'

/** Finds or lazily creates the school's "Library Fine" fee head, so
 * every library ad-hoc charge categorizes under one consistent head
 * instead of an untagged one-off. */
export async function ensureLibraryFineFeeHead(schoolId: string): Promise<string> {
  const { data: existing } = await supabase.from('fee_heads').select('id').eq('school_id', schoolId).eq('code', 'LIBRARY_FINE').maybeSingle()
  if (existing) return existing.id

  const { data: created, error } = await supabase.from('fee_heads')
    .insert({ school_id: schoolId, name: 'Library Fine', code: 'LIBRARY_FINE', default_amount: 0, is_refundable: false })
    .select('id').single()
  if (error) throw new Error(error.message)
  return created.id
}

/**
 * RTE-quota students already get fee concessions through
 * fee_concession_rules — a library fine should be able to lean on that
 * same rule engine instead of inventing a second concession system.
 * Only students on the current year's 'rte' fee_category are checked;
 * everyone else pays the fine as calculated. Returns the (possibly
 * reduced) amount to actually bill, and how much was waived, so the
 * caller can record why on the fine.
 */
export async function applyRteWaiverIfEligible(
  schoolId: string, studentId: string, feeHeadId: string, amount: number,
): Promise<{ billAmount: number; waivedAmount: number }> {
  const { data: year } = await supabase.from('academic_years').select('id').eq('school_id', schoolId).eq('is_current', true).maybeSingle()
  if (!year) return { billAmount: amount, waivedAmount: 0 }

  const { data: assignment } = await supabase.from('fee_assignments')
    .select('fee_category').eq('student_id', studentId).eq('academic_year_id', year.id).eq('status', 'active').maybeSingle()
  if (assignment?.fee_category !== 'rte') return { billAmount: amount, waivedAmount: 0 }

  const { data: rules } = await supabase.from('fee_concession_rules')
    .select('discount_type, discount_value, fee_head_id')
    .eq('school_id', schoolId).eq('academic_year_id', year.id).eq('is_active', true).eq('fee_category', 'rte')
    .or(`fee_head_id.eq.${feeHeadId},fee_head_id.is.null`)
  if (!rules?.length) return { billAmount: amount, waivedAmount: 0 }

  const discounts: ApplicableDiscount[] = rules.map(r => ({
    fee_head_id: r.fee_head_id, discount_type: r.discount_type as 'percentage' | 'fixed', discount_value: Number(r.discount_value),
  }))
  const waived = discountForLine(amount, discounts)
  return { billAmount: money(amount - waived), waivedAmount: money(waived) }
}
