import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Column, CreateDateColumn, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { RecordStatus } from './commerce-enums';

@Entity('store_vendor_payments')
export class StoreVendorPaymentEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ type: 'varchar', length: 50, unique: true,
    default: () => "'VNDP_' || lpad(nextval('public.store_vendor_payments_code_seq'::regclass)::text, 5, '0')" })
  code!: string;

  @Column({ name: 'payment_name', type: 'varchar', length: 150 }) paymentName!: string;
  @Column({ type: 'text', default: '' }) description!: string;
  @Column({ name: 'merchant_id', type: 'uuid' }) merchantId!: string;
  @Column({ name: 'store_id', type: 'uuid' }) storeId!: string;
  @Column({ name: 'shift_id', type: 'varchar', length: 100 }) shiftId!: string;
  @Column({ name: 'vendor_id', type: 'uuid' }) vendorId!: string;
  @Column({ name: 'vendor_name', type: 'varchar', length: 150 }) vendorName!: string;
  @Column({ name: 'payment_mode', type: 'varchar', length: 50 }) paymentMode!: string;
  @Column({ type: 'numeric', precision: 14, scale: 2 }) amount!: string;
  @Column({ name: 'created_by', type: 'uuid', nullable: true }) createdBy!: string | null;
  @Column({ name: 'updated_by', type: 'uuid', nullable: true }) updatedBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true }) updatedAt!: Date | null;
  @Column({ name: 'is_deleted', type: 'boolean', default: false }) isDeleted!: boolean;
  @Column({ type: 'enum', enum: RecordStatus, enumName: 'record_status', default: RecordStatus.ACTIVE }) status!: RecordStatus;

  static async createPayment(db: DataSource, body: Record<string, unknown>, actor?: { id?: string; merchantId?: string; storeId?: string; role?: string }) {
    if (!actor?.id) throw new ForbiddenException('Authentication is required');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Provide a payment JSON object');
    const allowed = ['payment_name','description','merchant_id','store_id','shift_id','vendor_id','payment_mode','amount'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new BadRequestException('Unsupported payment field; code, vendor_name and audit fields are server-managed');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const key of ['merchant_id','store_id','vendor_id']) {
      if (typeof body[key] !== 'string' || !uuid.test(body[key] as string)) throw new BadRequestException(`${key} must be a UUID`);
    }
    for (const [key, max] of [['payment_name',150],['shift_id',100],['payment_mode',50]] as const) {
      if (typeof body[key] !== 'string' || !String(body[key]).trim() || String(body[key]).length > max) throw new BadRequestException(`${key} must be a non-empty string of at most ${max} characters`);
    }
    if (body.description !== undefined && typeof body.description !== 'string') throw new BadRequestException('description must be a string');
    if (!['number','string'].includes(typeof body.amount) || !/^\d{1,12}(\.\d{1,2})?$/.test(String(body.amount)) || Number(body.amount) <= 0) throw new BadRequestException('amount must be positive with at most two decimal places');
    const merchantId = String(body.merchant_id).toLowerCase(), storeId = String(body.store_id).toLowerCase();
    if ((actor.merchantId && actor.merchantId.toLowerCase() !== merchantId) || (actor.storeId && actor.storeId.toLowerCase() !== storeId)
      || (actor.role !== 'OWNER' && actor.merchantId?.toLowerCase() !== merchantId)) throw new ForbiddenException('Payment scope does not match the authenticated session');
    return db.transaction(async manager => {
      const [shift] = await manager.query('SELECT id,merchant_id,store_id,status FROM public.pos_shifts WHERE id=$1 FOR UPDATE', [String(body.shift_id).trim()]);
      if (!shift) throw new NotFoundException('Shift not found');
      if (String(shift.store_id).toLowerCase() !== storeId || String(shift.merchant_id).toLowerCase() !== merchantId) throw new BadRequestException('Shift does not belong to the specified merchant and store');
      if (String(shift.status).toUpperCase() !== 'OPEN') throw new ConflictException('Vendor payments can only be added to an open shift');
      const [store] = await manager.query("SELECT s.id FROM public.stores s JOIN public.merchants m ON m.id=s.merchant_id WHERE s.id=$1::uuid AND m.id=$2::uuid AND COALESCE(s.is_deleted,false)=false AND COALESCE(m.is_deleted,false)=false AND m.status='ACTIVE'", [storeId,merchantId]);
      if (!store) throw new NotFoundException('Active merchant/store not found');
      const [vendor] = await manager.query("SELECT vendor_name FROM public.vendors WHERE id=$1::uuid AND deleted_at IS NULL AND status='ACTIVE'", [body.vendor_id]);
      if (!vendor) throw new NotFoundException('Active vendor not found');
      const [payment] = await manager.query(
        `INSERT INTO public.store_vendor_payments (payment_name,description,merchant_id,store_id,shift_id,vendor_id,vendor_name,payment_mode,amount,created_by)
         VALUES ($1,$2,$3::uuid,$4::uuid,$5,$6::uuid,$7,$8,$9::numeric,$10::uuid) RETURNING *`,
        [String(body.payment_name).trim(),body.description ?? '',merchantId,storeId,shift.id,body.vendor_id,vendor.vendor_name,String(body.payment_mode).trim().toUpperCase(),String(body.amount),actor.id],
      );
      return payment;
    });
  }

  static async listPayments(db: DataSource, merchantId?: string, storeId?: string, shiftId?: string) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!merchantId || !uuid.test(merchantId)) throw new BadRequestException('merchant_id must be a UUID');
    if (!storeId || !uuid.test(storeId)) throw new BadRequestException('store_id must be a UUID');
    if (typeof shiftId !== 'string' || !shiftId.trim() || shiftId.length > 100) throw new BadRequestException('shift_id is required and must be at most 100 characters');
    const scope = [merchantId.toLowerCase(),storeId.toLowerCase(),shiftId.trim()];
    const [shift] = await db.query(
      `SELECT s.id FROM public.pos_shifts s JOIN public.stores st ON st.id::text=s.store_id
       WHERE s.merchant_id=$1 AND s.store_id=$2 AND s.id=$3 AND st.merchant_id::text=$1`, scope);
    if (!shift) throw new NotFoundException('Shift not found for this merchant and store');
    return db.query(
      `SELECT * FROM public.store_vendor_payments
       WHERE merchant_id=$1::uuid AND store_id=$2::uuid AND shift_id=$3 AND is_deleted=false
       ORDER BY created_at DESC,id DESC`, scope);
  }

  static async changePayment(db: DataSource, id: string, patch: Record<string, unknown>, softDelete = false) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(id)) throw new BadRequestException('payment id must be a UUID');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new BadRequestException('Provide a payment JSON object');
    const allowed = ['payment_name','description','vendor_id','payment_mode','amount','merchant_id','store_id','shift_id'];
    if (Object.keys(patch).some(key => !allowed.includes(key))) throw new BadRequestException('Unsupported or server-managed payment field');
    const editable = ['payment_name','description','vendor_id','payment_mode','amount'];
    if (!softDelete && !editable.some(key => patch[key] !== undefined)) throw new BadRequestException('Provide at least one payment field to update');
    for (const [key,max] of [['payment_name',150],['payment_mode',50]] as const) {
      if (patch[key] !== undefined && (typeof patch[key] !== 'string' || !String(patch[key]).trim() || String(patch[key]).length > max)) throw new BadRequestException(`${key} must be a non-empty string of at most ${max} characters`);
    }
    if (patch.description !== undefined && typeof patch.description !== 'string') throw new BadRequestException('description must be a string');
    if (patch.vendor_id !== undefined && (typeof patch.vendor_id !== 'string' || !uuid.test(patch.vendor_id))) throw new BadRequestException('vendor_id must be a UUID');
    if (patch.amount !== undefined && (!['number','string'].includes(typeof patch.amount) || !/^\d{1,12}(\.\d{1,2})?$/.test(String(patch.amount)) || Number(patch.amount) <= 0)) throw new BadRequestException('amount must be positive with at most two decimal places');
    return db.transaction(async manager => {
      const [initial] = await manager.query('SELECT shift_id FROM public.store_vendor_payments WHERE id=$1::uuid AND is_deleted=false', [id]);
      if (!initial) throw new NotFoundException('Vendor payment not found');
      // Use the same lock order as creation and shift closing.
      const [shift] = await manager.query('SELECT id,created_by,status FROM public.pos_shifts WHERE id=$1 FOR UPDATE', [initial.shift_id]);
      if (!shift) throw new NotFoundException('Shift not found');
      if (String(shift.status).toUpperCase() !== 'OPEN') throw new ConflictException('Vendor payments can only be changed while the shift is open');
      if (!uuid.test(String(shift.created_by ?? ''))) throw new BadRequestException('Shift must have a valid employee UUID in created_by');
      const [current] = await manager.query('SELECT * FROM public.store_vendor_payments WHERE id=$1::uuid AND is_deleted=false FOR UPDATE', [id]);
      if (!current) throw new NotFoundException('Vendor payment not found');
      for (const key of ['merchant_id','store_id','shift_id']) {
        if (patch[key] !== undefined && String(patch[key]).toLowerCase() !== String(current[key]).toLowerCase()) throw new BadRequestException(`${key} cannot be changed`);
      }
      if (softDelete) {
        const [deleted] = await manager.query("UPDATE public.store_vendor_payments SET is_deleted=true,status='INACTIVE',updated_by=$2::uuid,updated_at=now() WHERE id=$1::uuid RETURNING *", [id,shift.created_by]);
        return deleted;
      }
      const next = { ...current, ...patch };
      const [vendor] = await manager.query("SELECT vendor_name FROM public.vendors WHERE id=$1::uuid AND deleted_at IS NULL AND status='ACTIVE'", [next.vendor_id]);
      if (!vendor) throw new NotFoundException('Active vendor not found');
      const [updated] = await manager.query(
        `UPDATE public.store_vendor_payments SET payment_name=$2,description=$3,vendor_id=$4::uuid,vendor_name=$5,
         payment_mode=$6,amount=$7::numeric,updated_by=$8::uuid,updated_at=now() WHERE id=$1::uuid RETURNING *`,
        [id,String(next.payment_name).trim(),next.description,next.vendor_id,vendor.vendor_name,String(next.payment_mode).trim().toUpperCase(),String(next.amount),shift.created_by]);
      return updated;
    });
  }

  static async prepareSchema(db: DataSource): Promise<void> {
    await db.query('CREATE SEQUENCE IF NOT EXISTS public.store_vendor_payments_code_seq START WITH 1 MAXVALUE 99999 NO CYCLE');
  }

  // createMissingTables creates columns from entities but does not create foreign keys.
  static async ensureConstraints(db: DataSource): Promise<void> {
    await db.transaction(async manager => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtextextended('store_vendor_payments:schema', 0))");
      await manager.query('ALTER SEQUENCE public.store_vendor_payments_code_seq OWNED BY public.store_vendor_payments.code');
      const references = [
        ['merchant', 'merchant_id', 'merchants'], ['store', 'store_id', 'stores'],
        ['shift', 'shift_id', 'pos_shifts'], ['vendor', 'vendor_id', 'vendors'],
      ];
      for (const [name, column, table] of references) {
        if (name !== 'shift') await manager.query(`CREATE UNIQUE INDEX IF NOT EXISTS store_vendor_payments_${name}_id_ref_uq ON public.${table}(id)`);
        await manager.query(`CREATE INDEX IF NOT EXISTS store_vendor_payments_${name}_idx ON public.store_vendor_payments(${column})`);
        const [constraint] = await manager.query("SELECT 1 FROM pg_constraint WHERE conrelid='public.store_vendor_payments'::regclass AND conname=$1", [`store_vendor_payments_${name}_fk`]);
        if (!constraint) await manager.query(`ALTER TABLE public.store_vendor_payments ADD CONSTRAINT store_vendor_payments_${name}_fk FOREIGN KEY (${column}) REFERENCES public.${table}(id)`);
      }
      const [amountCheck] = await manager.query("SELECT 1 FROM pg_constraint WHERE conrelid='public.store_vendor_payments'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%amount >=%'");
      if (!amountCheck) await manager.query('ALTER TABLE public.store_vendor_payments ADD CONSTRAINT store_vendor_payments_amount_check CHECK (amount >= 0)');
    });
  }
}
