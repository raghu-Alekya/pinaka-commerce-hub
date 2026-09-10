import {
  ConflictException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { SessionEntity } from '@pinaka-delivery-hub/auth';
import { CreateUserDto, UpdateUserDto } from './user.dto';
import { AccountEntity } from './account.entity';
import { RefreshTokenEntity } from './refresh-token.entity';
import { UserEntity, UserRole, UserStatus } from './user.entity';

@Injectable()
export class UserRepository implements OnModuleInit, OnModuleDestroy {
  private dataSource!: DataSource;
  private repository!: Repository<UserEntity>;
  private accountRepository!: Repository<AccountEntity>;
  private refreshTokenRepository!: Repository<RefreshTokenEntity>;
  private sessionRepository!: Repository<SessionEntity>;

  async onModuleInit(): Promise<void> {
    this.dataSource = await connectPostgres('Auth PostgreSQL', [
      UserEntity,
      AccountEntity,
      RefreshTokenEntity,
      SessionEntity,
    ]);
    this.repository = this.dataSource.getRepository(UserEntity);
    this.accountRepository = this.dataSource.getRepository(AccountEntity);
    this.refreshTokenRepository =
      this.dataSource.getRepository(RefreshTokenEntity);
    this.sessionRepository = this.dataSource.getRepository(SessionEntity);
    console.log('🐘 [Auth PostgreSQL] users, accounts, sessions, and refresh_tokens tables are ready');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource?.isInitialized) await this.dataSource.destroy();
  }

  async findAll(accountId?: string | null): Promise<UserEntity[]> {
    return this.repository.find({
      where: accountId ? { accountId } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async findById(
    id: string,
    accountId?: string | null,
  ): Promise<UserEntity | null> {
    return this.repository.findOneBy(accountId ? { id, accountId } : { id });
  }

  async create(dto: CreateUserDto): Promise<UserEntity> {
    await this.assertEmailAvailable(dto.email);
    try {
      return await this.repository.save(this.repository.create(dto));
    } catch (error: unknown) {
      this.handleUniqueEmailError(error, dto.email);
      throw error;
    }
  }

  async createAccountOwnerFromSignUp(
    email: string,
    passwordHash: string,
  ): Promise<{ account: AccountEntity; user: UserEntity }> {
    await this.assertEmailAvailable(email);
    const firstName = email.split('@')[0] || 'User';
    const accountName = `${firstName}'s Restaurant`;
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

  async findByEmailWithPassword(email: string): Promise<UserEntity | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    return this.repository.findOneBy({ email });
  }

  async createGoogleUser(
    email: string,
    firstName: string,
    lastName: string,
  ): Promise<UserEntity> {
    await this.assertEmailAvailable(email);
    return this.repository.save(
      this.repository.create({
        firstName,
        lastName,
        email,
        phoneNumber: '',
        role: UserRole.USER,
        notificationEnabled: true,
        status: UserStatus.ACTIVE,
      }),
    );
  }

  async createInvitedUser(
    dto: CreateUserDto,
    accountId: string | null,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<UserEntity> {
    await this.assertEmailAvailable(dto.email);
    try {
      return await this.repository.save(
        this.repository.create({
          ...dto,
          accountId,
          notificationEnabled: dto.notificationEnabled ?? true,
          status: UserStatus.PENDING,
          actionTokenHash: tokenHash,
          actionTokenType: 'INVITE',
          actionTokenExpiresAt: expiresAt,
        }),
      );
    } catch (error: unknown) {
      this.handleUniqueEmailError(error, dto.email);
      throw error;
    }
  }

  async setActionToken(
    userId: string,
    hash: string,
    type: 'INVITE' | 'RESET',
    expiresAt: Date,
  ): Promise<void> {
    await this.repository.update(userId, {
      actionTokenHash: hash,
      actionTokenType: type,
      actionTokenExpiresAt: expiresAt,
    });
  }

  async findByActionToken(
    hash: string,
    type: 'INVITE' | 'RESET',
  ): Promise<UserEntity | null> {
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

  async activateWithPassword(
    user: UserEntity,
    passwordHash: string,
  ): Promise<UserEntity> {
    user.status = UserStatus.ACTIVE;
    user.passwordHash = passwordHash;
    user.actionTokenHash = null;
    user.actionTokenType = null;
    user.actionTokenExpiresAt = null;
    return this.repository.save(user);
  }

  async createAccount(accountName: string): Promise<AccountEntity> {
    return this.accountRepository.save(
      this.accountRepository.create({ accountName }),
    );
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
    try {
      return await this.repository.save(user);
    } catch (error: unknown) {
      this.handleUniqueEmailError(error, dto.email ?? user.email);
      throw error;
    }
  }

  async delete(id: string, accountId?: string | null): Promise<boolean> {
    return (
      (await this.repository.delete(accountId ? { id, accountId } : { id }))
        .affected === 1
    );
  }

  async createRefreshToken(
    token: Pick<RefreshTokenEntity, 'id' | 'userId' | 'tokenHash' | 'expiresAt'>,
  ): Promise<void> {
    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create(token),
    );
  }

  async findActiveRefreshToken(id: string): Promise<RefreshTokenEntity | null> {
    const token = await this.refreshTokenRepository
      .createQueryBuilder('token')
      .addSelect('token.tokenHash')
      .where('token.id = :id', { id })
      .getOne();
    if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now())
      return null;
    return token;
  }

  async revokeRefreshToken(id: string, replacedById?: string): Promise<void> {
    await this.refreshTokenRepository.update(id, {
      revokedAt: new Date(),
      replacedById: replacedById ?? null,
    });
  }

  async createSession(session: Pick<
    SessionEntity,
    'id' | 'userId' | 'accountId' | 'email' | 'role' | 'accessTokenHash' | 'refreshTokenId' | 'expiresAt'
  >): Promise<SessionEntity> {
    return this.sessionRepository.save(this.sessionRepository.create(session));
  }

  async findActiveSession(id: string, accessTokenHash: string): Promise<SessionEntity | null> {
    const session = await this.sessionRepository
      .createQueryBuilder('session')
      .addSelect('session.accessTokenHash')
      .where('session.id = :id', { id })
      .getOne();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.accessTokenHash !== accessTokenHash
    ) {
      return null;
    }
    return session;
  }

  async touchSession(id: string): Promise<void> {
    await this.sessionRepository.update(id, { lastUsedAt: new Date() });
  }

  async revokeSession(id: string): Promise<void> {
    await this.sessionRepository.update(id, { revokedAt: new Date() });
  }

  async revokeSessionsForRefreshToken(refreshTokenId: string): Promise<void> {
    await this.sessionRepository.update(
      { refreshTokenId },
      { revokedAt: new Date() },
    );
  }

  private async assertEmailAvailable(
    email: string,
    excludedId?: string,
  ): Promise<void> {
    const users = await this.repository.findBy({ email });
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
