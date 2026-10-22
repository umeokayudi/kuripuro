// Real column names of the tables the admin AI may use (public schema, checked 2026-10-22).
// Without them the model guessed names like clients.name, PostgREST answered 42703
// ("column does not exist") and the request spent its time on failed lookups.
// When a table gains a column, add it here too.

export const TABLE_COLUMNS = {
  employees: 'id,full_name,phone,email,date_of_birth,address,my_number,contract_type,hourly_rate,bank_name,bank_branch,account_type,account_number,account_holder_katakana,score,is_active,created_at,salary_type,fixed_salary,job_bonus_rate,contract_start,contract_end,advance_per_week,attendance_bonus,transport_reimbursed,notes,work_days,hours_per_shift,shifts_per_week,work_days_per_week,monthly_work_days,last_seen,is_online,last_lat,last_lng,last_location_at,location_sharing,hire_date,job_role',
  jobs: 'id,title,client_id,client_name,employee_id,employee_name,scheduled_date,scheduled_time,address,gps_lat,gps_lng,value,description,checklist_template,photo_required,status,started_at,completed_at,notes_employee,photo_start_url,photo_end_url,created_at,job_category,spot_value,spot_status,spot_responded_at,counts_as_work_day,materials,reference_photos,instructions,sequence_order,gps_end_distance,gps_override,gps_start_distance,checklist_total,checklist_done,checklist_missed_items,photo_ai_score,photo_ai_approved,photo_ai_issues,signature_url,retro_report,retro_ai_summary,retro_value,retro_time_min,admin_reviewed,start_lat,start_lng,start_accuracy,end_lat,end_lng,end_accuracy,area',
  clients: 'id,company_name,contact_person,phone,email,address,service_type,monthly_revenue,monthly_cost_estimate,is_active,created_at,contact_name,monthly_cost,notes,manager_name,manager_email,manager_phone,manager_line_url,manager_photo_url,salesperson_id',
  salary_payments: 'id,employee_id,employee_name,period,amount,payment_date,status,description,created_at,payment_type,is_deduction',
  complaints: 'id,employee_id,employee_name,client_id,client_name,complaint_type,points_deducted,description,complaint_date,created_at',
  evaluations: 'id,employee_id,employee_name,job_id,job_title,type,stars,points_change,category,description,eval_date,created_at',
  transport_claims: 'id,employee_id,employee_name,job_id,job_title,claim_date,amount,route,description,receipt_url,photo_url,status,admin_note,created_at',
  equipment_requests: 'id,employee_id,employee_name,category,item_name,quantity,reason,photo_url,status,admin_note,reviewed_at,fulfilled_at,created_at',
  badges: 'id,employee_id,badge_key,badge_name,earned_at',
  checkins: 'id,employee_id,employee_name,client_id,client_name,checkin_date,checkin_type,checkin_time,transport_route,transport_cost,notes,photo_before_url,photo_during_url,photo_after_url,created_at,time_out,notes_out,gps_lat_in,gps_lng_in,gps_lat_out,gps_lng_out',
  messages: 'id,employee_id,employee_name,sender,content,read,created_at',
  faturas: 'id,client_id,client_name,period_start,period_end,issue_date,due_date,subtotal,tax_amount,total,tax_rate,status,notes,created_at,paid_at,payment_method,payment_reference,cashflow_id',
  salary_periods: 'id,period,closed_at,confirm_deadline,pay_date,status',
  cashflow: 'id,entry_type,category,description,amount,entry_date,created_at',
  locations: 'id,name,address,gps_lat,gps_lng,location_type,client_id,notes,is_active,created_at',
  client_users: 'id,client_id,client_name,location_name,contact_name,email,is_active,last_seen,created_at',
  client_messages: 'id,client_id,client_user_id,client_name,location_name,sender,content,read,created_at',
  client_complaints: 'id,client_id,client_user_id,job_id,location_name,employee_name,category,description,status,admin_response,created_at,resolved_at,photo_url',
  client_compliments: 'id,client_id,client_user_id,job_id,location_name,employee_name,message,status,admin_response,created_at,resolved_at',
  client_ratings: 'id,client_id,client_user_id,job_id,employee_name,location_name,stars,comment,created_at,photo_url',
  client_requests: 'id,client_id,client_user_id,location_name,description,preferred_date,status,admin_notes,ticket_number,created_at,completed_at,request_type,category,quote_amount,quote_note,quote_status,quoted_at,decided_at,salesperson_id,base_amount,seller_markup,priced_at,commission_paid_at',
  service_contracts: 'id,client_id,location_name,location_address,service_type,price_per_visit,hours_per_visit,days_of_week,visits_per_month,monthly_revenue,notes,is_active,created_at,tax_rate,price_includes_tax,training_video_url,training_checklist,billing_type,fixed_monthly,discount_percent,billing_day,billing_notes,area,contract_pdf_path,contract_pdf_saved_at,salesperson_id,commission_type,commission_value,commission_amount,contract_details',
  service_reports: 'id,checkin_id,employee_id,employee_name,client_name,report_date,time_in,time_out,transport_route,transport_cost,notes_in,notes_out,photo_before_url,photo_during_url,photo_after_url,pdf_url,created_at,checklist,gps_lat_in,gps_lng_in,gps_lat_out,gps_lng_out,client_id,location_name,photo_comment,job_id,job_title,duration_min,report_type,retro_ai_summary,checklist_done,checklist_total,checklist_missed_items,photo_ai_score,photo_ai_approved,photo_ai_issues,signature_url,job_value',
}

/** One line per table, for the system prompt. */
export function schemaPrompt(tables) {
  return tables
    .map(t => `- ${t}: ${TABLE_COLUMNS[t] || '(use select "*" to see the columns)'}`)
    .join('\n')
}

/** Turns PostgREST's "column x.y does not exist" into a message that lists the real columns. */
export function explainColumnError(table, message) {
  if (!/42703|does not exist/.test(String(message))) return message
  const cols = TABLE_COLUMNS[table]
  return cols
    ? `${message} — use only these columns of ${table}: ${cols}`
    : `${message} — query ${table} with select "*" first to see its columns.`
}
