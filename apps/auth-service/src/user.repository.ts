import {
  ConflictException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CreateUserDto, UpdateUserDto } from './user.dto';
import { AccountEntity } from './account.entity';
import { RefreshTokenEntity } from './refresh-token.entity';
import { UserEntity, UserRole, UserStatus } from './user.entity';

@Injectable()
export class UserRepository implements OnModuleInit, OnModuleDestroy {
  private dataSource?: DataSource;
  private repository?: Repository<UserEntity>;
  private accountRepository?: Repository<AccountEntity>;
  private refreshTokenRepository?: Repository<RefreshTokenEntity>;
  private readonly inMemoryUsers: UserEntity[] = [];
  private readonly inMemoryAccounts: AccountEntity[] = [];
  private readonly inMemoryPasswords = new Map<string, string>();
  private readonly inMemoryTokens = new Map<
    string,
    { hash: string; type: 'INVITE' | 'RESET'; expiresAt: Date }
  >();
  private readonly inMemoryRefreshTokens = new Map<string, RefreshTokenEntity>();

  async onModuleInit(): Promise<void> {
    try {
      this.dataSource = new DataSource({
        type: 'postgres',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: Number(process.env.POSTGRES_PORT) || 5432,
        username: process.env.POSTGRES_USER || 'pdh_user',
        password: process.env.POSTGRES_PASSWORD || 'pdh_password',
        database: process.env.POSTGRES_DB || 'pinaka_delivery_hub',
        entities: [UserEntity, AccountEntity, RefreshTokenEntity],
        synchronize: true,
      });
      await this.dataSource.initialize();
      this.repository = this.dataSource.getRepository(UserEntity);
      this.accountRepository = this.dataSource.getRepository(AccountEntity);
      this.refreshTokenRepository = this.dataSource.getRepository(RefreshTokenEntity);
      console.log('🐘 [Auth PostgreSQL] Connected; users table is ready');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `⚠️ [Auth PostgreSQL] Offline (${message}). Using in-memory fallback.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource?.isInitialized) await this.dataSource.destroy();
  }

  async findAll(accountId?: string | null): Promise<UserEntity[]> {
    return this.repository
      ? this.repository.find({
          where: accountId ? { accountId } : {},
          order: { createdAt: 'DESC' },
        })
      : this.inMemoryUsers.filter(
          (user) => !accountId || user.accountId === accountId,
        );
  }

  async findById(
    id: string,
    accountId?: string | null,
  ): Promise<UserEntity | null> {
    return this.repository
      ? this.repository.findOneBy(accountId ? { id, accountId } : { id })
      : (this.inMemoryUsers.find(
          (user) =>
            user.id === id && (!accountId || user.accountId === accountId),
        ) ?? null);
  }

  async create(dto: CreateUserDto): Promise<UserEntity> {
    await this.assertEmailAvailable(dto.email);
    if (this.repository) {
      try {
        return await this.repository.save(this.repository.create(dto));
      } catch (error: unknown) {
        this.handleUniqueEmailError(error, dto.email);
        throw error;
      }
    }
    const now = new Date();
    const user: UserEntity = {
      id: randomUUID(),
      ...dto,
      notificationEnabled: dto.notificationEnabled ?? true,
      status: UserStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };
    this.inMemoryUsers.unshift(user);
    return user;
  }

  async createAccountOwnerFromSignUp(
    email: string,
    passwordHash: string,
  ): Promise<{ account: AccountEntity; user: UserEntity }> {
    await this.assertEmailAvailable(email);
    const firstName = email.split('@')[0] || 'User';
    const accountName = `${firstName}'s Restaurant`;

    if (this.dataSource?.isInitialized) {
      try {
        return await this.dataSource.transaction(async (manager) => {
          const account = await manager.save(
            manager.create(AccountEntity, { accountName }),
          );
          const user = await manager.save(
            manager.create(UserEntity, {
              accountId: account.id,
              firstName,
              lastName: '',
              email,
              phoneNumber: '',
              role: UserRole.OWNER,
              notificationEnabled: true,
              status: UserStatus.ACTIVE,
              passwordHash,
            }),
          );
          return { account, user };
        });
      } catch (error: unknown) {
        this.handleUniqueEmailError(error, email);
        throw error;
      }
    }

    const now = new Date();
    const account: AccountEntity = {
      id: randomUUID(),
      accountName,
      createdAt: now,
      updatedAt: now,
    };
    const user: UserEntity = {
      id: randomUUID(),
      accountId: account.id,
      firstName,
      lastName: '',
      email,
      phoneNumber: '',
      role: UserRole.OWNER,
      notificationEnabled: true,
      status: UserStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };
    this.inMemoryAccounts.push(account);
    this.inMemoryUsers.unshift(user);
    this.inMemoryPasswords.set(user.id, passwordHash);
    return { account, user };
  }

  async findByEmailWithPassword(email: string): Promise<UserEntity | null> {
    if (this.repository) {
      return this.repository
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.email = :email', { email })
        .getOne();
    }
    const user = this.inMemoryUsers.find(
      (candidate) => candidate.email === email,
    );
    if (!user) return null;
    return { ...user, passwordHash: this.inMemoryPasswords.get(user.id) };
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.repository
      ? this.repository.findOneBy({ email })
      : (this.inMemoryUsers.find((user) => user.email === email) ?? null);
  }

  async createGoogleUser(
    email: string,
    firstName: string,
    lastName: string,
  ): Promise<UserEntity> {
    await this.assertEmailAvailable(email);
    const values: Partial<UserEntity> = {
      firstName,
      lastName,
      email,
      phoneNumber: '',
      role: UserRole.USER,
      notificationEnabled: true,
      status: UserStatus.ACTIVE,
    };
    if (this.repository)
      return this.repository.save(this.repository.create(values));
    const now = new Date();
    const user: UserEntity = {
      id: randomUUID(),
      ...values,
      firstName,
      lastName,
      email,
      phoneNumber: '',
      role: UserRole.USER,
      notificationEnabled: true,
      status: UserStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
    };
    this.inMemoryUsers.unshift(user);
    return user;
  }

  async createInvitedUser(
    dto: CreateUserDto,
    accountId: string | null,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<UserEntity> {
    await this.assertEmailAvailable(dto.email);
    if (this.repository) {
      const entity = this.repository.create({
        ...dto,
        accountId,
        notificationEnabled: dto.notificationEnabled ?? true,
        status: UserStatus.PENDING,
        actionTokenHash: tokenHash,
        actionTokenType: 'INVITE',
        actionTokenExpiresAt: expiresAt,
      });
      try {
        return await this.repository.save(entity);
      } catch (error: unknown) {
        this.handleUniqueEmailError(error, dto.email);
        throw error;
      }
    }
    const now = new Date();
    const user: UserEntity = {
      id: randomUUID(),
      accountId,
      ...dto,
      notificationEnabled: dto.notificationEnabled ?? true,
      status: UserStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    };
    this.inMemoryUsers.unshift(user);
    this.inMemoryTokens.set(user.id, {
      hash: tokenHash,
      type: 'INVITE',
      expiresAt,
    });
    return user;
  }

  async setActionToken(
    userId: string,
    hash: string,
    type: 'INVITE' | 'RESET',
    expiresAt: Date,
  ): Promise<void> {
    if (this.repository) {
      await this.repository.update(userId, {
        actionTokenHash: hash,
        actionTokenType: type,
        actionTokenExpiresAt: expiresAt,
      });
      return;
    }
    this.inMemoryTokens.set(userId, { hash, type, expiresAt });
  }

  async findByActionToken(
    hash: string,
    type: 'INVITE' | 'RESET',
  ): Promise<UserEntity | null> {
    if (this.repository) {
      return this.repository
        .createQueryBuilder('user')
        .addSelect([
          'user.actionTokenHash',
          'user.actionTokenType',
          'user.actionTokenExpiresAt',
        ])
        .where('user.actionTokenHash = :hash', { hash })
        .andWhere('user.actionTokenType = :type', { type })
        .getOne();
    }
    const match = this.inMemoryUsers.find((user) => {
      const token = this.inMemoryTokens.get(user.id);
      return token?.hash === hash && token.type === type;
    });
    return match ?? null;
  }

  async activateWithPassword(
    user: UserEntity,
    passwordHash: string,
  ): Promise<UserEntity> {
    user.status = UserStatus.ACTIVE;
    user.passwordHash = passwordHash;
    user.actionTokenHash = null;
    user.actionTokenType = null;
    user.actionTokenExpiresAt = null;
    if (this.repository) return this.repository.save(user);
    this.inMemoryPasswords.set(user.id, passwordHash);
    this.inMemoryTokens.delete(user.id);
    user.updatedAt = new Date();
    return user;
  }

  async createAccount(accountName: string): Promise<AccountEntity> {
    if (this.accountRepository)
      return this.accountRepository.save(
        this.accountRepository.create({ accountName }),
      );
    const now = new Date();
    const account: AccountEntity = {
      id: randomUUID(),
      accountName,
      createdAt: now,
      updatedAt: now,
    };
    this.inMemoryAccounts.push(account);
    return account;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    accountId?: string | null,
  ): Promise<UserEntity | null> {
    const user = await this.findById(id, accountId);
    if (!user) return null;
    if (dto.email && dto.email !== user.email)
      await this.assertEmailAvailable(dto.email, id);
    Object.assign(user, dto, { updatedAt: new Date() });
    if (this.repository) {
      try {
        return await this.repository.save(user);
      } catch (error: unknown) {
        this.handleUniqueEmailError(error, dto.email ?? user.email);
        throw error;
      }
    }
    return user;
  }

  async delete(id: string, accountId?: string | null): Promise<boolean> {
    if (this.repository)
      return (
        (await this.repository.delete(accountId ? { id, accountId } : { id }))
          .affected === 1
      );
    const index = this.inMemoryUsers.findIndex((user) => user.id === id);
    if (index < 0) return false;
    this.inMemoryPasswords.delete(id);
    this.inMemoryTokens.delete(id);
    this.inMemoryUsers.splice(index, 1);
    return true;
  }

  async createRefreshToken(
    token: Pick<RefreshTokenEntity, 'id' | 'userId' | 'tokenHash' | 'expiresAt'>,
  ): Promise<void> {
    if (this.refreshTokenRepository) {
      await this.refreshTokenRepository.save(this.refreshTokenRepository.create(token));
      return;
    }
    const now = new Date();
    this.inMemoryRefreshTokens.set(token.id, {
      ...token,
      revokedAt: null,
      replacedById: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async findActiveRefreshToken(id: string): Promise<RefreshTokenEntity | null> {
    const token = this.refreshTokenRepository
      ? await this.refreshTokenRepository.createQueryBuilder('token')
          .addSelect('token.tokenHash')
          .where('token.id = :id', { id })
          .getOne()
      : this.inMemoryRefreshTokens.get(id) ?? null;
    if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now()) return null;
    return token;
  }

  async revokeRefreshToken(id: string, replacedById?: string): Promise<void> {
    if (this.refreshTokenRepository) {
      await this.refreshTokenRepository.update(id, {
        revokedAt: new Date(),
        replacedById: replacedById ?? null,
      });
      return;
    }
    const token = this.inMemoryRefreshTokens.get(id);
    if (token) {
      token.revokedAt = new Date();
      token.replacedById = replacedById ?? null;
      token.updatedAt = new Date();
    }
  }

  private async assertEmailAvailable(
    email: string,
    excludedId?: string,
  ): Promise<void> {
    const users = this.repository
      ? await this.repository.findBy({ email })
      : this.inMemoryUsers.filter((user) => user.email === email);
    if (users.some((user) => user.id !== excludedId))
      throw new ConflictException(
        `A user with email '${email}' already exists`,
      );
  }

  private handleUniqueEmailError(error: unknown, email: string): void {
    if (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string }).code === '23505'
    ) {
      throw new ConflictException(
        `A user with email '${email}' already exists`,
      );
    }
  }
}
