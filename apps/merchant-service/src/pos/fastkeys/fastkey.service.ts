import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { MerchantRepository } from '../../modules/merchant/merchant.repository';
import { EmployeeEntity } from '../../entities/employee.entity';
import { StoreEntity } from '../../entities/store.entity';
import { ProductEntity } from '../../entities/product.entity';
import { AddFastkeyProductsDto, CreateFastkeyDto } from './fastkey.dto';
import { StoreEmployeeFastkeyEntity } from './store-employee-fastkey.entity';
import { In } from 'typeorm';

type FastkeyContext = { employee_id: string; store_id: string };
@Injectable()
export class FastkeyService {
  constructor(
    @Inject(MerchantRepository)
    private readonly merchants: MerchantRepository,
  ) {}

  async create(dto: CreateFastkeyDto, userId: string | undefined, origin: string) {
    const title = String(dto.fastkey_title ?? '').trim();
    if (!title) {
      throw new HttpException({ message: 'Missing required fields' }, 400);
    }

    if (!userId) throw new UnauthorizedException('Authentication is required');

    const fastkeyIndex = this.toWordPressInteger(dto.fastkey_index);
    const image = String(dto.fastkey_image ?? '').trim()
      || process.env.FASTKEY_DEFAULT_IMAGE_URL?.trim()
      || `${origin}/uploads/fastkeys/no-image-2.png`;
    const db = this.merchants.requireDataSource();
    const context = await this.resolveContext();

    const repository = db.getRepository(StoreEmployeeFastkeyEntity);
    const existing = await repository.find({
      where: {
        storeId: context.store_id,
        employeeId: context.employee_id,
        isDeleted: false,
      },
      select: { id: true, json: true },
    });
    if (existing.some(item => item.json.fastkey_title.trim().toLocaleLowerCase() === title.toLocaleLowerCase())) {
      throw new HttpException({
        status: 'error',
        message: 'You already have a Fast Key with this title.',
      }, 409);
    }

    try {
      const saved = await repository.save(repository.create({
        storeId: context.store_id,
        employeeId: context.employee_id,
        json: { fastkey_title: title, fastkey_index: fastkeyIndex },
        fastkeyImage: image,
        isDeleted: false,
      }));
      return {
        status: 'success',
        message: 'Fast Key created',
        fastkey_id: saved.id,
        fastkey_title: title,
        fastkey_index: fastkeyIndex,
        fastkey_image: image,
      };
    } catch (error) {
      if (this.postgresCode(error) === '23505') {
        throw new HttpException({
          status: 'error',
          message: 'You already have a Fast Key with this title.',
        }, 409);
      }
      if (error instanceof HttpException) throw error;
      throw new HttpException({ message: 'Error creating Fast Key', status: 'error' }, 500);
    }
  }

  async getByUser(userId: string | undefined, origin: string) {
    if (!userId) throw new UnauthorizedException('Authentication is required');

    const context = await this.resolveContext();
    const rows = await this.merchants.requireDataSource()
      .getRepository(StoreEmployeeFastkeyEntity)
      .find({
        where: {
          employeeId: context.employee_id,
          storeId: context.store_id,
          isDeleted: false,
        },
      });

    const fastkeys = await Promise.all(rows
      .sort((left, right) => this.fastkeyIndex(left) - this.fastkeyIndex(right))
      .map(async row => {
        const assignments = this.productAssignments(row);
        const products = await this.enhanceProducts(row.storeId, assignments);
        return {
          fastkey_id: row.id,
          fastkey_title: String(row.json?.fastkey_title ?? ''),
          fastkey_image: row.fastkeyImage?.trim()
            || `${origin}/uploads/fastkeys/no-image.png`,
          itemCount: assignments.length,
          user_id: context.employee_id,
          fastkey_index: this.fastkeyIndex(row),
          products,
        };
      }));

    return {
      user_id: context.employee_id,
      message: 'FastKeys retrieved successfully',
      status: 'success',
      fastkeys,
    };
  }

  async addProducts(
    dto: AddFastkeyProductsDto,
    userId: string | undefined,
    origin: string,
  ) {
    if (!userId) throw new UnauthorizedException('Authentication is required');
    if (!dto.fastkey_id || !Array.isArray(dto.products) || !dto.products.length) {
      throw new HttpException({ message: 'Missing required fields', status: 'error' }, 400);
    }
    const fastkeyId = dto.fastkey_id;
    const requestedProducts = dto.products;

    const db = this.merchants.requireDataSource();
    const context = await this.resolveContext();
    const fastkeyRepository = db.getRepository(StoreEmployeeFastkeyEntity);
    const fastkey = await fastkeyRepository.findOne({
      where: {
        id: fastkeyId,
        employeeId: context.employee_id,
        storeId: context.store_id,
        isDeleted: false,
      },
    });
    if (!fastkey) {
      throw new HttpException({ status: 'error', message: 'Fast Key not found' }, 404);
    }

    const requestedIds = [...new Set(requestedProducts.map(item => item.product_id))];
    const catalogProducts = await db.getRepository(ProductEntity).find({
      where: { storeId: fastkey.storeId, id: In(requestedIds) },
      select: { id: true },
    });
    const existingProductIds = new Set(catalogProducts.map(item => item.id));
    const updatedProducts = this.productAssignments(fastkey);
    const assignedProductIds = new Set(updatedProducts.map(item => item.product_id));
    const failedProducts: Array<Record<string, unknown>> = [];
    for (const requested of requestedProducts) {
      if (!existingProductIds.has(requested.product_id)) {
        failedProducts.push({
          product_id: requested.product_id,
          message: 'Product does not exist',
          status: 'failed',
        });
        continue;
      }
      if (assignedProductIds.has(requested.product_id)) {
        failedProducts.push({
          product_id: requested.product_id,
          message: 'Product already added to this Fast Key',
          status: 'duplicate',
        });
        continue;
      }
      updatedProducts.push({
        product_id: requested.product_id,
        sl_number: requested.sl_number,
      });
      assignedProductIds.add(requested.product_id);
    }

    fastkey.json = { ...fastkey.json, products: updatedProducts };
    await fastkeyRepository.save(fastkey);
    const products = await this.enhanceProducts(fastkey.storeId, updatedProducts);

    return {
      fastkey_id: fastkey.id,
      fastkey_title: String(fastkey.json.fastkey_title ?? ''),
      fastkey_image: fastkey.fastkeyImage?.trim()
        || `${origin}/uploads/fastkeys/no-image.png`,
      fastkey_index: this.fastkeyIndex(fastkey),
      itemCount: updatedProducts.length,
      message: failedProducts.length
        ? 'Some products failed to add'
        : 'FastKeys updated successfully',
      status: failedProducts.length ? 'partial_success' : 'success',
      products,
      failed_products: failedProducts,
    };
  }

  private async resolveContext(): Promise<FastkeyContext> {
    const db = this.merchants.requireDataSource();
    const [employee] = await db.getRepository(EmployeeEntity).find({
      order: { createdAt: 'ASC' },
      select: { id: true },
      take: 1,
    });
    if (!employee) {
      throw new ForbiddenException('No employee record is available');
    }
    const [store] = await db.getRepository(StoreEntity).find({
      order: { createdAt: 'ASC' },
      select: { id: true },
      take: 1,
    });
    if (!store) {
      throw new ForbiddenException('No store record is available');
    }
    return { employee_id: employee.id, store_id: store.id };
  }

  private toWordPressInteger(value: string | undefined): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private fastkeyIndex(row: StoreEmployeeFastkeyEntity): number {
    const index = Number(row.json?.fastkey_index);
    return Number.isFinite(index) && index !== 0 ? Math.trunc(index) : 1;
  }

  private productAssignments(
    row: StoreEmployeeFastkeyEntity,
  ): Array<{ product_id: string; sl_number: number }> {
    if (!Array.isArray(row.json?.products)) return [];
    return row.json.products
      .map(item => ({
        product_id: String(item.product_id ?? '').trim(),
        sl_number: Number(item.sl_number),
      }))
      .filter(item => item.product_id.length > 0);
  }

  private async enhanceProducts(
    storeId: string,
    assignments: Array<{ product_id: string; sl_number: number }>,
  ): Promise<Array<Record<string, unknown>>> {
    if (!assignments.length) return [];
    const db = this.merchants.requireDataSource();
    const catalogProducts = await db.getRepository(ProductEntity).find({
      where: {
        storeId,
        id: In([...new Set(assignments.map(item => item.product_id))]),
      },
    });
    const productsById = new Map(catalogProducts.map(item => [item.id, item]));
    return assignments.flatMap(assignment => {
      const product = productsById.get(assignment.product_id);
      return product
        ? [this.presentProduct(product, assignment.sl_number)]
        : [];
    });
  }

  private presentProduct(
    product: ProductEntity,
    serialNumber: number,
  ): Record<string, unknown> {
    const payload = this.catalogProductPayload(product.payload);
    const type = String(payload.type ?? '').toLocaleLowerCase();
    const children = Array.isArray(payload.children) ? payload.children : [];
    return {
      product_id: product.id,
      name: String(payload.name ?? ''),
      price: payload.price ?? '',
      image: String(payload.image ?? ''),
      category: payload.categoryName ? [String(payload.categoryName)] : [],
      sl_number: serialNumber,
      sku: String(payload.sku ?? ''),
      is_variant: type === 'variation' || payload.is_variant === true,
      has_variants: payload.has_variants === true
        || (type === 'variable' && children.length > 0),
      tags: Array.isArray(payload.tags) ? payload.tags : [],
    };
  }

  private catalogProductPayload(payload: unknown[]): Record<string, unknown> {
    const first = Array.isArray(payload) ? payload[0] : undefined;
    return first && typeof first === 'object'
      ? first as Record<string, unknown>
      : {};
  }

  private postgresCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const record = error as { code?: string; driverError?: { code?: string } };
    return record.code ?? record.driverError?.code;
  }
}
