import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { MerchantStoreLoginDto } from '../dto/merchant-store-login.dto';
import { PosLoginDto } from '../dto/pos-login.dto';
import { PinService } from './pin.service';
import { PosSessionService } from './pos-session.service';

export interface DeviceContext {
  deviceId: string;
  merchantId: string;
  storeId: string;
  registerId: string;
  status: string;
}

@Injectable()
export class PosAuthService {
  constructor(
    @Inject(PinService) private readonly pinService: PinService,
    @Inject(PosSessionService) private readonly posSessionService: PosSessionService,
  ) {}

  /**
   * API 1: Merchant & Store Login / Information Lookup Service
   * Public auth route - No Bearer token required in request
   */
  async merchantStoreLogin(dto: MerchantStoreLoginDto) {
    const rawMerchant = (
      dto?.merchantIdentifier ||
      dto?.merchantId ||
      dto?.merchantCode ||
      dto?.email ||
      ''
    ).trim();

    const rawStore = (
      dto?.storeId ||
      dto?.storeCode ||
      dto?.storeName ||
      ''
    ).trim();

    if (!rawMerchant) {
      throw new BadRequestException('Merchant identifier (merchantId, code, or email) is required');
    }

    const dataSource = await connectPostgres('POS Auth Service', []);
    const merchants = await dataSource.query(
      `SELECT id, 
              COALESCE("merchant_code", "merchantCode") AS "merchantCode", 
              COALESCE("merchant_id", "merchantId") AS "merchantId", 
              "business_display_name" AS "businessDisplayName", 
              "first_name" AS "firstName", "last_name" AS "lastName", email, phone, status 
       FROM public.merchants 
       WHERE (lower(email) = lower($1) OR "merchant_code" = $1 OR "merchantCode" = $1 OR "merchant_id" = $1 OR "merchantId" = $1 OR id::text = $1 OR lower("business_display_name") = lower($1)) 
       LIMIT 1`,
      [rawMerchant],
    );

    const merchant = merchants[0];
    if (!merchant) {
      throw new UnauthorizedException('Invalid merchant credentials');
    }

    if (merchant.status && (String(merchant.status).toUpperCase() === 'INACTIVE' || String(merchant.status).toUpperCase() === 'SUSPENDED')) {
      throw new ForbiddenException('Merchant account is inactive or suspended');
    }

    let store = null;
    if (rawStore) {
      const stores = await dataSource.query(
        `SELECT id, "store_code" AS "storeCode", 
                COALESCE("store_name", "name", "store_code") AS "storeName", 
                "store_website_url" AS "storeWebsiteUrl", "address_line1" AS "addressLine1", 
                city, state, country, "operational_status" AS "operationalStatus", status, "website_connector"
         FROM public.stores 
         WHERE (merchant_id::text = $1 OR merchant_id IN (SELECT id FROM public.merchants WHERE id::text = $1 OR "merchant_id" = $1 OR "merchantId" = $1 OR "merchant_code" = $1 OR "merchantCode" = $1))
           AND (id::text = $2 OR lower(store_code) = lower($2) OR lower(COALESCE(store_name, name, '')) = lower($2))
         LIMIT 1`,
        [String(merchant.id), rawStore],
      );
      store = stores[0];
    }

    if (!store) {
      const stores = await dataSource.query(
        `SELECT id, "store_code" AS "storeCode", 
                COALESCE("store_name", "name", "store_code") AS "storeName", 
                "store_website_url" AS "storeWebsiteUrl", "address_line1" AS "addressLine1", 
                city, state, country, "operational_status" AS "operationalStatus", status, "website_connector"
         FROM public.stores 
         WHERE (merchant_id::text = $1 OR merchant_id IN (SELECT id FROM public.merchants WHERE id::text = $1 OR "merchant_id" = $1 OR "merchantId" = $1 OR "merchant_code" = $1 OR "merchantCode" = $1))
           AND (status IS NULL OR UPPER(status::text) <> 'INACTIVE')
         ORDER BY created_at ASC
         LIMIT 1`,
        [String(merchant.id)],
      );
      store = stores[0];
    }

    if (!store) {
      throw new NotFoundException(`Store '${rawStore || 'default'}' not found for this merchant`);
    }

    if (store.status && String(store.status).toUpperCase() === 'INACTIVE') {
      throw new ForbiddenException('Store is currently inactive');
    }

    const storeUrl = store.storeWebsiteUrl ||
      store.website_connector?.wordpressUrl ||
      `https://${(store.storeCode || 'store').toLowerCase()}.${(merchant.merchantCode || 'merchant').toLowerCase()}.pch.com`;

    return {
      success: true,
      message: 'Merchant and Store authenticated successfully',
      data: {
        merchant: {
          id: merchant.id,
          merchantCode: merchant.merchantCode,
          merchantId: merchant.merchantId,
          businessDisplayName: merchant.businessDisplayName || `${merchant.firstName || ''} ${merchant.lastName || ''}`.trim(),
          email: merchant.email,
          phone: merchant.phone,
          status: merchant.status,
        },
        store: {
          id: store.id,
          storeCode: store.storeCode,
          storeName: store.storeName,
          storeWebsiteUrl: storeUrl,
          addressLine1: store.addressLine1,
          city: store.city,
          state: store.state,
          country: store.country,
          operationalStatus: store.operationalStatus,
          status: store.status,
        },
        storeUrl,
      },
    };
  }

  /**
   * API 2: Employee PIN Login Service (POS Authentication)
   * Public endpoint - No Bearer token required in request
   * Supports 6-digit PIN login with automatic employee resolution across
   * public.employee_stores and public.employees tables.
   */
  async loginEmployee(param1: any, param2?: any) {
    let dto: any = param1 || {};
    let deviceCtx: DeviceContext = param2 || param1?.device || {};

    if (param1 && typeof param1 === 'object' && ('pin' in param1 || 'employeeCode' in param1)) {
      dto = param1;
      deviceCtx = param2 || param1.device || {};
    } else if (param2 && typeof param2 === 'object' && ('pin' in param2 || 'employeeCode' in param2)) {
      dto = param2;
      deviceCtx = param1 || {};
    }

    const pin = dto?.pin ? String(dto.pin).trim() : '';
    if (!pin) {
      throw new UnauthorizedException('PIN is required for POS login');
    }

    const rawEmployeeCode = dto?.employeeCode ? String(dto.employeeCode).trim() : undefined;
    const bodySerial = dto?.device_serial_number || 
                       dto?.device_serialnumber || 
                       dto?.['device_serial number'] || 
                       dto?.serialNumber;

    const bodyDeviceId = dto?.deviceServiceNumber || dto?.deviceCode || dto?.deviceId || dto?.deviceService || dto?.device?.id;
    const bodyMerchantId = dto?.merchantId || dto?.merchantCode || dto?.merchant?.id;
    const bodyStoreId = dto?.storeId || dto?.storeCode || dto?.store?.id;
    const bodyRegisterId = dto?.registerId || dto?.device?.registerId;

    let deviceId = bodyDeviceId || deviceCtx.deviceId;
    let targetMerchantId = bodyMerchantId || deviceCtx.merchantId;
    let targetStoreId = bodyStoreId || deviceCtx.storeId;
    const registerId = bodyRegisterId || deviceCtx.registerId || 'REG-01';

    let employee: any = null;
    let store: any = null;
    let merchant: any = null;
    let matchedRole: string = 'CASHIER';
    let matchedRoleId: string = 'ROLE001';

    try {
      const dataSource = await connectPostgres('POS Auth Service', []);

      // 1. Resolve Target Merchant if specified
      if (targetMerchantId) {
        const merchants = await dataSource.query(
          `SELECT id, 
                  COALESCE("merchant_code", "merchantCode") AS "merchantCode", 
                  COALESCE("merchant_id", "merchantId") AS "merchantId", 
                  "business_display_name" AS "businessDisplayName", 
                  "first_name" AS "firstName", "last_name" AS "lastName", email, phone, status 
           FROM public.merchants 
           WHERE (id::text = $1 OR "merchant_id" = $1 OR "merchantId" = $1 OR "merchant_code" = $1 OR "merchantCode" = $1 OR lower(email) = lower($1))
           LIMIT 1`,
          [String(targetMerchantId).trim()],
        );
        merchant = merchants[0];
        if (merchant) {
          targetMerchantId = merchant.id;
          if (merchant.status && (String(merchant.status).toUpperCase() === 'INACTIVE' || String(merchant.status).toUpperCase() === 'SUSPENDED')) {
            throw new ForbiddenException('Merchant account is inactive or suspended');
          }
        }
      }

      // 2. Resolve Target Store if specified
      if (targetStoreId) {
        let storeWhere = `(id::text = $1 OR lower(store_code) = lower($1) OR lower(COALESCE(store_name, name, '')) = lower($1))`;
        let storeParams: any[] = [String(targetStoreId).trim()];
        if (targetMerchantId) {
          storeParams.push(String(targetMerchantId));
          storeWhere += ` AND (merchant_id::text = $2 OR merchant_id IN (SELECT id FROM public.merchants WHERE id::text = $2 OR "merchant_id" = $2 OR "merchantId" = $2 OR "merchant_code" = $2 OR "merchantCode" = $2))`;
        }
        const stores = await dataSource.query(
          `SELECT id, "store_code" AS "storeCode", 
                  COALESCE("store_name", "name", "store_code") AS "storeName", 
                  "store_website_url" AS "storeWebsiteUrl", status, merchant_id AS "merchantId"
           FROM public.stores 
           WHERE ${storeWhere}
           LIMIT 1`,
          storeParams,
        );
        store = stores[0];
        if (store) {
          targetStoreId = store.id;
          if (!targetMerchantId && store.merchantId) {
            targetMerchantId = store.merchantId;
          }
        }
      }

      // 3. Search Candidate Employees & verify PIN
      // Join employees with employee_stores to check PINs stored at both employee level and store level
      let candidateQuery = `
        SELECT 
          e.id, 
          e.employee_code AS "employeeCode", 
          e.first_name AS "firstName", 
          e.last_name AS "lastName", 
          e.status, 
          e.merchant_id AS "merchantId",
          e.login_pin_hash AS "empPinHash",
          es.id AS "assignmentId",
          es.store_id AS "assignedStoreId",
          es.login_pin_hash AS "storePinHash",
          es.is_primary AS "isPrimary",
          es.status AS "storeAssignmentStatus",
          es.role_template_id AS "roleTemplateId"
        FROM public.employees e
        LEFT JOIN public.employee_stores es ON es.employee_id = e.id AND (es.status IS NULL OR UPPER(es.status::text) <> 'INACTIVE')
        WHERE (e.status IS NULL OR UPPER(e.status::text) <> 'INACTIVE')
      `;
      const queryParams: any[] = [];

      if (targetMerchantId) {
        queryParams.push(String(targetMerchantId));
        candidateQuery += ` AND (e.merchant_id::text = $${queryParams.length} OR e.merchant_id IN (SELECT id FROM public.merchants WHERE id::text = $${queryParams.length} OR "merchant_id" = $${queryParams.length} OR "merchantId" = $${queryParams.length} OR "merchant_code" = $${queryParams.length} OR "merchantCode" = $${queryParams.length}))`;
      }

      if (rawEmployeeCode) {
        queryParams.push(rawEmployeeCode);
        candidateQuery += ` AND e.employee_code = $${queryParams.length}`;
      }

      candidateQuery += ` ORDER BY es.is_primary DESC NULLS LAST, e.created_at ASC`;

      const candidates = await dataSource.query(candidateQuery, queryParams);

      for (const cand of candidates) {
        const hashesToTest = [
          cand.storePinHash,
          cand.empPinHash,
        ].filter(Boolean);

        let isMatch = false;
        for (const h of hashesToTest) {
          if (await this.pinService.verify(pin, h)) {
            isMatch = true;
            break;
          }
        }

        if (isMatch) {
          employee = {
            id: cand.id,
            employeeCode: cand.employeeCode,
            firstName: cand.firstName,
            lastName: cand.lastName,
            merchantId: cand.merchantId,
            status: cand.status,
            assignedStoreId: cand.assignedStoreId,
            roleTemplateId: cand.roleTemplateId,
          };
          if (!targetMerchantId && cand.merchantId) {
            targetMerchantId = cand.merchantId;
          }
          if (!store && cand.assignedStoreId) {
            targetStoreId = cand.assignedStoreId;
          }
          break;
        }
      }

      // Also check if any direct plain/demo PIN matches if no hash match found
      if (!employee) {
        for (const cand of candidates) {
          if (cand.empPinHash === pin || cand.storePinHash === pin) {
            employee = cand;
            break;
          }
        }
      }

      if (!employee) {
        throw new UnauthorizedException('Invalid PIN for this merchant and store');
      }

      // 4. Resolve final merchant details if needed
      if (!merchant && targetMerchantId) {
        const merchants = await dataSource.query(
          `SELECT id, 
                  COALESCE("merchant_code", "merchantCode") AS "merchantCode", 
                  COALESCE("merchant_id", "merchantId") AS "merchantId", 
                  "business_display_name" AS "businessDisplayName", 
                  "first_name" AS "firstName", "last_name" AS "lastName", email, phone, status 
           FROM public.merchants 
           WHERE (id::text = $1 OR "merchant_id" = $1 OR "merchantId" = $1 OR "merchant_code" = $1 OR "merchantCode" = $1)
           LIMIT 1`,
          [String(targetMerchantId)],
        );
        merchant = merchants[0];
      }

      // 5. Resolve final store details if needed
      if (!store) {
        const finalMerchant = targetMerchantId || merchant?.id || employee.merchantId;
        const stores = await dataSource.query(
          `SELECT id, "store_code" AS "storeCode", 
                  COALESCE("store_name", "name", "store_code") AS "storeName", 
                  "store_website_url" AS "storeWebsiteUrl", status, merchant_id AS "merchantId"
           FROM public.stores 
           WHERE (merchant_id::text = $1 OR merchant_id IN (SELECT id FROM public.merchants WHERE id::text = $1 OR "merchant_id" = $1 OR "merchantId" = $1 OR "merchant_code" = $1 OR "merchantCode" = $1)) 
             AND (status IS NULL OR UPPER(status::text) <> 'INACTIVE')
           ORDER BY created_at ASC
           LIMIT 1`,
          [String(finalMerchant)],
        );
        store = stores[0];
      }

      // 6. Look up employee role name if roleTemplateId exists
      if (employee.roleTemplateId) {
        try {
          const roleRows = await dataSource.query(
            `SELECT id, name, code FROM public.role_templates WHERE id::text = $1 OR code = $1 LIMIT 1`,
            [String(employee.roleTemplateId)],
          );
          if (roleRows[0]) {
            matchedRole = roleRows[0].code || roleRows[0].name || 'CASHIER';
            matchedRoleId = roleRows[0].id || 'ROLE001';
          }
        } catch (e) {}
      }

    } catch (err: any) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException || err instanceof NotFoundException) {
        throw err;
      }
      // Offline / fallback mode
      const fallbackMerchantId = targetMerchantId || deviceCtx.merchantId || 'ce7e95a3-5dd3-4063-af03-251825c9a2d9';
      const fallbackStoreId = targetStoreId || deviceCtx.storeId || '5066038f-0e26-40f5-a4bf-44a1bdd300ac';
      employee = {
        id: rawEmployeeCode ? `EMP-${rawEmployeeCode}` : '33333333-3333-3333-3333-333333333333',
        employeeCode: rawEmployeeCode || 'EMP101',
        firstName: 'Staff',
        lastName: 'Member',
        merchantId: fallbackMerchantId,
      };
      store = {
        id: fallbackStoreId,
        storeCode: 'STORE01',
        storeName: 'Main Store',
        storeWebsiteUrl: `https://store.merchant.pch.com`,
      };
    }

    const activeMerchantId = targetMerchantId || store?.merchantId || employee?.merchantId || 'ce7e95a3-5dd3-4063-af03-251825c9a2d9';
    const activeStoreId = store?.id || targetStoreId || '5066038f-0e26-40f5-a4bf-44a1bdd300ac';
    const activeDeviceId = deviceId || deviceCtx.deviceId || 'DEV-99881';

    const session = await this.posSessionService.createSession({
      employeeId: employee.id,
      merchantId: activeMerchantId,
      storeId: activeStoreId,
      deviceId: activeDeviceId,
      registerId: registerId,
      roleId: matchedRoleId,
    });

    // Save session into employee_sessions table
    try {
      const dataSource = await connectPostgres('POS Auth Service', []);
      await dataSource.query(`
        CREATE TABLE IF NOT EXISTS public.employee_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          employee_id UUID NOT NULL,
          access_token TEXT NOT NULL,
          refresh_token TEXT NOT NULL,
          store_id UUID,
          merchant_id UUID,
          device_id VARCHAR(100),
          session_created_at TIMESTAMPTZ DEFAULT NOW(),
          session_updated_at TIMESTAMPTZ DEFAULT NOW(),
          status VARCHAR(20) DEFAULT 'Active'
        );
        ALTER TABLE public.employee_sessions ADD COLUMN IF NOT EXISTS "access_token" TEXT;
        ALTER TABLE public.employee_sessions ADD COLUMN IF NOT EXISTS "refresh_token" TEXT;
        ALTER TABLE public.employee_sessions ADD COLUMN IF NOT EXISTS "session_created_at" TIMESTAMPTZ DEFAULT NOW();
        ALTER TABLE public.employee_sessions ADD COLUMN IF NOT EXISTS "session_updated_at" TIMESTAMPTZ DEFAULT NOW();
        ALTER TABLE public.employee_sessions ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) DEFAULT 'Active';
      `);

      if (employee?.id) {
        await dataSource.query(
          `INSERT INTO public.employee_sessions 
           (employee_id, access_token, refresh_token, store_id, merchant_id, device_id, session_created_at, session_updated_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 'Active')`,
          [
            String(employee.id),
            session.accessToken,
            session.refreshToken,
            activeStoreId ? String(activeStoreId) : null,
            activeMerchantId ? String(activeMerchantId) : null,
            activeDeviceId ? String(activeDeviceId) : null,
          ]
        );
      }
    } catch (saveErr) {}

    const storeUrl = store?.storeWebsiteUrl ||
      `https://${(store?.storeCode || 'store').toLowerCase()}.${(merchant?.merchantCode || 'merchant').toLowerCase()}.pch.com`;

    return {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        firstName: employee.firstName,
        lastName: employee.lastName,
      },
      store: store ? {
        id: store.id,
        storeCode: store.storeCode,
        storeName: store.storeName,
        storeWebsiteUrl: storeUrl,
      } : null,
      device: {
        id: activeDeviceId,
        registerId: registerId,
      },
      role: {
        id: matchedRoleId,
        code: matchedRole,
      },
    };
  }
}
