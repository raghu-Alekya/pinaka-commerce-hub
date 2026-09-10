import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { CustomerEntity, LoyaltyTier } from './entities/customer.entity';
import { PromotionEntity, DiscountType } from './entities/promotion.entity';
import { LoyaltyTransactionEntity, PointTransactionType } from './entities/loyalty-transaction.entity';

@Injectable()
export class LoyaltyRepository implements OnModuleInit {
  private dataSource?: DataSource;
  private custRepo?: Repository<CustomerEntity>;
  private promoRepo?: Repository<PromotionEntity>;
  private txnRepo?: Repository<LoyaltyTransactionEntity>;
  private redisClient?: Redis;
  private isDbConnected = false;
  private isRedisConnected = false;

  private inMemoryCusts: CustomerEntity[] = [];
  private inMemoryPromos: PromotionEntity[] = [];
  private inMemoryTxns: LoyaltyTransactionEntity[] = [];

  public checkRedisStatus(): boolean { return this.isRedisConnected; }
  async onModuleInit() {
    this.dataSource = await connectPostgres('Loyalty Service DB', [
      CustomerEntity,
      PromotionEntity,
      LoyaltyTransactionEntity,
    ]);
    this.custRepo = this.dataSource.getRepository(CustomerEntity);
    this.promoRepo = this.dataSource.getRepository(PromotionEntity);
    this.txnRepo = this.dataSource.getRepository(LoyaltyTransactionEntity);
    this.isDbConnected = true;
    await this.seedDefaultData();

    try {
      this.redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      await this.redisClient.connect();
      this.isRedisConnected = true;
      console.log('⚡ [Loyalty Service Redis] Connected to Redis Container');
    } catch (err: any) {
      console.log(`⚠️ [Loyalty Service Redis] Offline (${err.message}).`);
      this.isRedisConnected = false;
    }
  }

  private async seedDefaultData() {
    if (this.custRepo && this.promoRepo) {
      const existingCust = await this.custRepo.findOne({ where: { phone: '+1 (555) 019-2831' } });
      if (!existingCust) {
        const cust = this.custRepo.create({
          id: 'CUST-5001',
          merchantId: 'MCH-1001',
          fullName: 'David Miller',
          phone: '+1 (555) 019-2831',
          email: 'david.miller@gmail.com',
          loyaltyTier: LoyaltyTier.GOLD,
          rewardPointsBalance: 350,
          totalSpent: 480.00,
        });
        await this.custRepo.save(cust);
      }

      const existingPromo = await this.promoRepo.findOne({ where: { promoCode: 'WELCOME10' } });
      if (!existingPromo) {
        const promo = this.promoRepo.create({
          id: 'PROMO-9001',
          merchantId: 'MCH-1001',
          storeId: 'STR-5001',
          promoCode: 'WELCOME10',
          discountType: DiscountType.PERCENTAGE,
          discountValue: 10.00,
          minOrderAmount: 20.00,
          usageLimit: 500,
          usedCount: 12,
          isActive: true,
        });
        await this.promoRepo.save(promo);
        console.log('🎁 [Loyalty Service] Seeded default customer & promo code WELCOME10');
      }
    }
  }

  private seedInMemory() {
    if (this.inMemoryCusts.length === 0) {
      this.inMemoryCusts.push({
        id: 'CUST-5001',
        merchantId: 'MCH-1001',
        fullName: 'David Miller',
        phone: '+1 (555) 019-2831',
        email: 'david.miller@gmail.com',
        loyaltyTier: LoyaltyTier.GOLD,
        rewardPointsBalance: 350,
        totalSpent: 480.00,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      this.inMemoryPromos.push({
        id: 'PROMO-9001',
        merchantId: 'MCH-1001',
        storeId: 'STR-5001',
        promoCode: 'WELCOME10',
        discountType: DiscountType.PERCENTAGE,
        discountValue: 10.00,
        minOrderAmount: 20.00,
        usageLimit: 500,
        usedCount: 12,
        isActive: true,
        createdAt: new Date(),
      });
    }
  }

  async getCustomerByPhone(phone: string): Promise<CustomerEntity | null> {
    if (this.isDbConnected && this.custRepo) {
      return await this.custRepo.findOne({ where: { phone } });
    }
    return this.inMemoryCusts.find((c) => c.phone === phone) || null;
  }

  async earnPoints(customerId: string, orderId: string, orderTotal: number): Promise<{ customer: CustomerEntity; pointsEarned: number }> {
    const pointsEarned = Math.floor(orderTotal); // $1 spent = 1 reward point
    let cust: CustomerEntity | null = null;

    if (this.isDbConnected && this.custRepo) {
      cust = await this.custRepo.findOne({ where: { id: customerId } });
      if (cust) {
        cust.rewardPointsBalance = Number(cust.rewardPointsBalance) + pointsEarned;
        cust.totalSpent = Number(cust.totalSpent) + orderTotal;
        if (cust.totalSpent > 1000) cust.loyaltyTier = LoyaltyTier.PLATINUM;
        else if (cust.totalSpent > 500) cust.loyaltyTier = LoyaltyTier.GOLD;
        else if (cust.totalSpent > 200) cust.loyaltyTier = LoyaltyTier.SILVER;
        cust = await this.custRepo.save(cust);
      }
    } else {
      cust = this.inMemoryCusts.find((c) => c.id === customerId) || null;
      if (cust) {
        cust.rewardPointsBalance = Number(cust.rewardPointsBalance) + pointsEarned;
        cust.totalSpent = Number(cust.totalSpent) + orderTotal;
        cust.updatedAt = new Date();
      }
    }

    if (!cust) throw new Error(`Customer '${customerId}' not found`);
    await this.recordPointTxn(customerId, orderId, PointTransactionType.EARNED, pointsEarned, cust.rewardPointsBalance, `Earned ${pointsEarned} points on Order #${orderId}`);
    return { customer: cust, pointsEarned };
  }

  async validatePromoCode(promoCode: string, orderAmount: number): Promise<{ isValid: boolean; discountAmount: number; promo?: PromotionEntity; message?: string }> {
    let promo: PromotionEntity | null = null;

    if (this.isDbConnected && this.promoRepo) {
      promo = await this.promoRepo.findOne({ where: { promoCode: promoCode.toUpperCase(), isActive: true } });
    } else {
      promo = this.inMemoryPromos.find((p) => p.promoCode === promoCode.toUpperCase() && p.isActive) || null;
    }

    if (!promo) {
      return { isValid: false, discountAmount: 0, message: `Invalid or expired promo code '${promoCode}'` };
    }

    if (orderAmount < Number(promo.minOrderAmount)) {
      return { isValid: false, discountAmount: 0, message: `Order minimum $${promo.minOrderAmount} required for '${promoCode}'` };
    }

    let discountAmount = 0;
    if (promo.discountType === DiscountType.PERCENTAGE) {
      discountAmount = Math.round((orderAmount * (Number(promo.discountValue) / 100)) * 100) / 100;
    } else {
      discountAmount = Number(promo.discountValue);
    }

    return { isValid: true, discountAmount, promo };
  }

  private async recordPointTxn(customerId: string, orderId: string, type: PointTransactionType, points: number, newBal: number, desc: string) {
    const entry: LoyaltyTransactionEntity = {
      id: `TXN-LOY-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      customerId,
      orderId,
      transactionType: type,
      points,
      newBalance: newBal,
      description: desc,
      createdAt: new Date(),
    };

    if (this.isDbConnected && this.txnRepo) {
      try {
        const entity = this.txnRepo.create(entry);
        await this.txnRepo.save(entity);
      } catch {}
    } else {
      this.inMemoryTxns.push(entry);
    }
  }
}
