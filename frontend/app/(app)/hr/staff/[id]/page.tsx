'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { hrmsApi } from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { ArrowLeft, User, Calendar, IndianRupee, Loader2, Check, X, Plus, Edit3 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const TABS = ['Profile', 'Leave', 'Payroll'] as const

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [tab, setTab] = useState<typeof TABS[number]>('Profile')
  const [editMode, setEditMode] = useState(false)
  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [showSalaryModal, setShowSalaryModal] = useState(false)
  const [showPayslipModal, setShowPayslipModal] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['hr-staff-detail', id],
    queryFn: () => hrmsApi.staff.get(id).then(r => r.data),
  })

  const { data: leaveBalances } = useQuery({
    queryKey: ['leave-balances', id],
    queryFn: () => hrmsApi.leaveBalances(id).then(r => r.data),
    enabled: !!id,
  })

  const leaveApproveMutation = useMutation({
    mutationFn: ({ leaveId, status }: any) => hrmsApi.leaveRequests.update(leaveId, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-staff-detail', id] })
      qc.invalidateQueries({ queryKey: ['leave-balances', id] })
      toast.success('Leave status updated')
    },
  })

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
  }
  if (!data) return <div className="text-center text-gray-400 py-20">Staff member not found</div>

  const profile = data.profile

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link href="/hr/staff" className="p-2 hover:bg-gray-100 rounded-xl transition-colors mt-1">
          <ArrowLeft className="w-5 h-5 text-gray-500" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">{data.full_name}</h1>
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 capitalize">
              {data.role?.replace('_', ' ')}
            </span>
            {profile?.employment_status && (
              <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold capitalize',
                profile.employment_status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                {profile.employment_status.replace('_', ' ')}
              </span>
            )}
          </div>
          <p className="text-gray-500 text-sm mt-1">
            {profile?.designation ?? 'No designation set'}
            {profile?.department && ` · ${profile.department}`}
            {profile?.employee_id && ` · ${profile.employee_id}`}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn('px-4 py-2 rounded-lg text-sm font-semibold transition-all',
              tab === t ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Profile' && (
        <ProfileTab data={data} profile={profile} staffId={id} editMode={editMode} setEditMode={setEditMode} />
      )}

      {tab === 'Leave' && (
        <LeaveTab
          data={data}
          balances={leaveBalances ?? []}
          staffId={id}
          onApprove={(leaveId) => leaveApproveMutation.mutate({ leaveId, status: 'approved' })}
          onReject={(leaveId) => leaveApproveMutation.mutate({ leaveId, status: 'rejected' })}
          isPending={leaveApproveMutation.isPending}
        />
      )}

      {tab === 'Payroll' && (
        <PayrollTab data={data} staffId={id} userName={data.full_name} />
      )}
    </div>
  )
}

// ── PROFILE TAB ────────────────────────────────────────────────
function ProfileTab({ data, profile, staffId, editMode, setEditMode }: any) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    employee_id: profile?.employee_id ?? '',
    designation: profile?.designation ?? '',
    department: profile?.department ?? '',
    date_of_joining: profile?.date_of_joining ?? '',
    date_of_birth: profile?.date_of_birth ?? '',
    gender: profile?.gender ?? '',
    qualification: profile?.qualification ?? '',
    experience_years: profile?.experience_years ?? '',
    phone: profile?.phone ?? '',
    personal_email: profile?.personal_email ?? '',
    address: profile?.address ?? '',
    city: profile?.city ?? '',
    state: profile?.state ?? '',
    bank_name: profile?.bank_name ?? '',
    bank_account_number: profile?.bank_account_number ?? '',
    bank_ifsc: profile?.bank_ifsc ?? '',
    pan_number: profile?.pan_number ?? '',
    employment_type: profile?.employment_type ?? 'full_time',
    employment_status: profile?.employment_status ?? 'active',
    emergency_contact_name: profile?.emergency_contact_name ?? '',
    emergency_contact_phone: profile?.emergency_contact_phone ?? '',
  })

  const saveMutation = useMutation({
    mutationFn: () => hrmsApi.staff.updateProfile(staffId, {
      ...form,
      experience_years: form.experience_years ? Number(form.experience_years) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-staff-detail', staffId] })
      qc.invalidateQueries({ queryKey: ['hr-staff'] })
      toast.success('Profile updated')
      setEditMode(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? 'Failed to update'),
  })

  const ic = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-gray-50 focus:bg-white disabled:opacity-60 disabled:bg-gray-50"

  const Field = ({ label, name, type = 'text', options }: any) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {options ? (
        <select className={ic} disabled={!editMode} value={(form as any)[name]} onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}>
          {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input type={type} className={ic} disabled={!editMode} value={(form as any)[name]}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))} />
      )}
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><User className="w-4 h-4 text-gray-400" /> Personal & Employment Details</h3>
          {!editMode ? (
            <button onClick={() => setEditMode(true)} className="flex items-center gap-1.5 text-sm text-indigo-600 font-medium hover:text-indigo-700">
              <Edit3 className="w-3.5 h-3.5" /> Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditMode(false)} className="text-sm text-gray-500 font-medium px-3 py-1.5">Cancel</button>
              <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-60">
                {saveMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Employee ID" name="employee_id" />
          <Field label="Designation" name="designation" />
          <Field label="Department" name="department" />
          <Field label="Date of Joining" name="date_of_joining" type="date" />
          <Field label="Date of Birth" name="date_of_birth" type="date" />
          <Field label="Gender" name="gender" options={[{value:'',label:'Select'},{value:'male',label:'Male'},{value:'female',label:'Female'},{value:'other',label:'Other'}]} />
          <Field label="Qualification" name="qualification" />
          <Field label="Experience (years)" name="experience_years" type="number" />
          <Field label="Employment Type" name="employment_type" options={[
            {value:'full_time',label:'Full Time'},{value:'part_time',label:'Part Time'},{value:'contract',label:'Contract'},{value:'probation',label:'Probation'}
          ]} />
          <Field label="Employment Status" name="employment_status" options={[
            {value:'active',label:'Active'},{value:'on_leave',label:'On Leave'},{value:'suspended',label:'Suspended'},{value:'resigned',label:'Resigned'},{value:'terminated',label:'Terminated'}
          ]} />
          <Field label="Phone" name="phone" />
          <Field label="Personal Email" name="personal_email" type="email" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Address</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-3"><Field label="Address" name="address" /></div>
          <Field label="City" name="city" />
          <Field label="State" name="state" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Bank & Tax Details</h3>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Bank Name" name="bank_name" />
          <Field label="Account Number" name="bank_account_number" />
          <Field label="IFSC Code" name="bank_ifsc" />
          <Field label="PAN Number" name="pan_number" />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Emergency Contact</h3>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Contact Name" name="emergency_contact_name" />
          <Field label="Contact Phone" name="emergency_contact_phone" />
        </div>
      </div>
    </div>
  )
}

// ── LEAVE TAB ──────────────────────────────────────────────────
function LeaveTab({ data, balances, staffId, onApprove, onReject, isPending }: any) {
  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="space-y-5">
      {/* Leave balances */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {(balances ?? []).map((b: any) => (
          <div key={b.leave_type_id} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-xs text-gray-400 font-medium">{b.code}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{b.remaining_days}</p>
            <p className="text-xs text-gray-400">of {b.total_days} days</p>
          </div>
        ))}
      </div>

      {/* Leave requests */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Calendar className="w-4 h-4 text-gray-400" /> Leave History</h3>
        </div>
        {(data.recent_leaves ?? []).length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Calendar className="w-8 h-8 mx-auto mb-2 text-gray-200" />
            <p className="text-sm font-medium">No leave requests yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {(data.recent_leaves ?? []).map((lr: any) => (
              <div key={lr.id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{lr.leave_types?.name ?? 'Leave'}</span>
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', STATUS_COLORS[lr.status])}>{lr.status}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{formatDate(lr.from_date)} → {formatDate(lr.to_date)} · {lr.total_days} day(s)</p>
                  {lr.reason && <p className="text-xs text-gray-400 mt-1">{lr.reason}</p>}
                </div>
                {lr.status === 'pending' && (
                  <div className="flex gap-2">
                    <button onClick={() => onApprove(lr.id)} disabled={isPending}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg hover:bg-emerald-100 disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button onClick={() => onReject(lr.id)} disabled={isPending}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 disabled:opacity-50">
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── PAYROLL TAB ────────────────────────────────────────────────
function PayrollTab({ data, staffId, userName }: any) {
  const qc = useQueryClient()
  const [showSalaryModal, setShowSalaryModal] = useState(false)
  const salary = data.salary_structure

  const gross = salary ? (salary.basic_salary + (salary.hra ?? 0) + (salary.da ?? 0) + (salary.conveyance_allowance ?? 0) + (salary.medical_allowance ?? 0) + (salary.other_allowances ?? 0)) : 0
  const deductions = salary ? ((salary.pf_deduction ?? 0) + (salary.professional_tax ?? 0) + (salary.other_deductions ?? 0)) : 0
  const net = gross - deductions

  const PAY_STATUS_COLORS: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    paid: 'bg-emerald-100 text-emerald-700',
    on_hold: 'bg-red-100 text-red-700',
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  return (
    <div className="space-y-5">
      {/* Salary structure */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><IndianRupee className="w-4 h-4 text-gray-400" /> Salary Structure</h3>
          <button onClick={() => setShowSalaryModal(true)} className="flex items-center gap-1.5 text-sm text-indigo-600 font-medium hover:text-indigo-700">
            <Edit3 className="w-3.5 h-3.5" /> {salary ? 'Update' : 'Set'} Salary
          </button>
        </div>

        {!salary ? (
          <div className="text-center py-8 text-gray-400">
            <IndianRupee className="w-8 h-8 mx-auto mb-2 text-gray-200" />
            <p className="text-sm font-medium">No salary structure set</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
            <div><p className="text-xs text-gray-400">Basic Salary</p><p className="font-semibold text-gray-900">₹{Number(salary.basic_salary).toLocaleString('en-IN')}</p></div>
            <div><p className="text-xs text-gray-400">HRA</p><p className="font-semibold text-gray-900">₹{Number(salary.hra ?? 0).toLocaleString('en-IN')}</p></div>
            <div><p className="text-xs text-gray-400">DA</p><p className="font-semibold text-gray-900">₹{Number(salary.da ?? 0).toLocaleString('en-IN')}</p></div>
            <div><p className="text-xs text-gray-400">Conveyance</p><p className="font-semibold text-gray-900">₹{Number(salary.conveyance_allowance ?? 0).toLocaleString('en-IN')}</p></div>
            <div><p className="text-xs text-gray-400">Medical Allowance</p><p className="font-semibold text-gray-900">₹{Number(salary.medical_allowance ?? 0).toLocaleString('en-IN')}</p></div>
            <div><p className="text-xs text-gray-400">Other Allowances</p><p className="font-semibold text-gray-900">₹{Number(salary.other_allowances ?? 0).toLocaleString('en-IN')}</p></div>
            <div className="border-t border-gray-100 pt-3 col-span-3 grid grid-cols-3 gap-x-8">
              <div><p className="text-xs text-gray-400">Gross Salary</p><p className="font-bold text-emerald-600">₹{gross.toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-gray-400">Total Deductions</p><p className="font-bold text-red-500">₹{deductions.toLocaleString('en-IN')}</p></div>
              <div><p className="text-xs text-gray-400">Net Salary</p><p className="font-bold text-indigo-600 text-lg">₹{net.toLocaleString('en-IN')}</p></div>
            </div>
            <div className="col-span-3 grid grid-cols-3 gap-x-8 text-xs text-gray-400 pt-2 border-t border-gray-50">
              <div>PF: ₹{Number(salary.pf_deduction ?? 0).toLocaleString('en-IN')}</div>
              <div>Prof. Tax: ₹{Number(salary.professional_tax ?? 0).toLocaleString('en-IN')}</div>
              <div>Other: ₹{Number(salary.other_deductions ?? 0).toLocaleString('en-IN')}</div>
            </div>
          </div>
        )}
      </div>

      {/* Payslips history */}
      <div className="bg-white rounded-2xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Payslip History</h3>
        </div>
        {(data.recent_payslips ?? []).length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <IndianRupee className="w-8 h-8 mx-auto mb-2 text-gray-200" />
            <p className="text-sm font-medium">No payslips generated yet</p>
            <p className="text-xs mt-1">Generate from HR → Payroll</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Period</th>
                <th className="px-6 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Gross</th>
                <th className="px-6 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Deductions</th>
                <th className="px-6 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Net Pay</th>
                <th className="px-6 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(data.recent_payslips ?? []).map((p: any) => (
                <tr key={p.id}>
                  <td className="px-6 py-3 font-medium text-gray-900">{MONTHS[p.month-1]} {p.year}</td>
                  <td className="px-6 py-3 text-gray-600">₹{Number(p.gross_salary).toLocaleString('en-IN')}</td>
                  <td className="px-6 py-3 text-gray-600">₹{Number(p.total_deductions).toLocaleString('en-IN')}</td>
                  <td className="px-6 py-3 font-semibold text-gray-900">₹{Number(p.net_salary).toLocaleString('en-IN')}</td>
                  <td className="px-6 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', PAY_STATUS_COLORS[p.payment_status])}>{p.payment_status.replace('_',' ')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showSalaryModal && (
        <SalaryModal staffId={staffId} userName={userName} existing={salary} onClose={() => {
          setShowSalaryModal(false)
          qc.invalidateQueries({ queryKey: ['hr-staff-detail', staffId] })
        }} />
      )}
    </div>
  )
}

function SalaryModal({ staffId, userName, existing, onClose }: any) {
  const [form, setForm] = useState({
    basic_salary: existing?.basic_salary ?? '',
    hra: existing?.hra ?? '',
    da: existing?.da ?? '',
    conveyance_allowance: existing?.conveyance_allowance ?? '',
    medical_allowance: existing?.medical_allowance ?? '',
    other_allowances: existing?.other_allowances ?? '',
    pf_deduction: existing?.pf_deduction ?? '',
    professional_tax: existing?.professional_tax ?? '',
    other_deductions: existing?.other_deductions ?? '',
  })
  const [loading, setLoading] = useState(false)

  const handleSave = async () => {
    if (!form.basic_salary) return toast.error('Basic salary is required')
    setLoading(true)
    try {
      await hrmsApi.salaryStructure.set({
        user_id: staffId,
        ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? 0 : Number(v)])),
        basic_salary: Number(form.basic_salary),
      })
      toast.success('Salary structure saved')
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed')
    } finally { setLoading(false) }
  }

  const ic = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-gray-50 focus:bg-white"

  const Field = ({ label, name }: any) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input type="number" className={ic} value={(form as any)[name]} onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))} placeholder="0" />
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Salary Structure — {userName}</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Earnings</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Basic Salary *" name="basic_salary" />
              <Field label="HRA" name="hra" />
              <Field label="DA" name="da" />
              <Field label="Conveyance" name="conveyance_allowance" />
              <Field label="Medical Allowance" name="medical_allowance" />
              <Field label="Other Allowances" name="other_allowances" />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Deductions</p>
            <div className="grid grid-cols-3 gap-3">
              <Field label="PF" name="pf_deduction" />
              <Field label="Professional Tax" name="professional_tax" />
              <Field label="Other Deductions" name="other_deductions" />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 font-medium">Cancel</button>
          <button onClick={handleSave} disabled={loading}
            className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 flex items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Save Salary Structure
          </button>
        </div>
      </div>
    </div>
  )
}
