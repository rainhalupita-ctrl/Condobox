export type PackageStatus = 'RECEIVED' | 'NOTIFIED' | 'DELIVERED' | 'RETURNED';
export type UserRole = 'ADMIN' | 'SYNDIC' | 'GUARD' | 'RESIDENT';

export interface Unit {
  id: string;
  condo_id?: string;
  block: string;
  unit_number: string;
  created_at?: string;
}

export interface Resident {
  id: string;
  unit_id: string;
  user_id?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  is_authorized_receiver: boolean;
  is_primary: boolean;
  active: boolean;
  unit?: Unit;
}

export interface Package {
  id: string;
  condo_id?: string;
  unit_id: string;
  resident_id?: string | null;
  carrier: string;
  tracking_code?: string | null;
  recipient_name_ocr?: string | null;
  status: PackageStatus;
  pickup_code: string;
  qr_token: string;
  label_image_path?: string | null;
  signature_image_path?: string | null;
  received_at: string;
  received_by_user_id?: string | null;
  delivered_at?: string | null;
  delivered_by_user_id?: string | null;
  delivered_to_name?: string | null;
  notes?: string | null;
  unit?: Unit;
  resident?: Resident;
}

export interface NotificationLog {
  id: string;
  package_id: string;
  resident_id?: string;
  recipient_phone: string;
  message_content: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'DELIVERED';
  error_message?: string | null;
  sent_at?: string | null;
  created_at: string;
}
