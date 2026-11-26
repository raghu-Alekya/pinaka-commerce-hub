import {
  ConflictException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { connectPostgres, createMissingTables } from '@pinaka-delivery-hub/database';
import { SessionEntity } from '@pinaka-delivery-hub/auth';
import { CreatePchUserDto, CreateUserDto, UpdateUserDto } from './user.dto';
import { AccountEntity } from './account.entity';
import { RefreshTokenEntity } from './refresh-token.entity';
import { UserEntity, UserRole, UserStatus } from './user.entity';

@Injectable()
export class UserRepository implements OnModuleInit, OnModuleDestroy {
  private dataSource!: DataSource;
  private repository!: Repository<UserEntity>;
  private refreshTokenRepository!: Repository<RefreshTokenEntity>;
  private sessionRepository!: Repository<SessionEntity>;

  async onModuleInit(): Promise<void> {
    this.dataSource = await connectPostgres('Auth PostgreSQL', [
      UserEntity,
      RefreshTokenEntity,
      SessionEntity,
    ], { synchronize: false });
    await AccountEntity.dropLegacyTable(this.dataSource);
    const createdTables = await createMissingTables(this.dataSource);
    if (createdTables.length) {
      console.log(`🐘 [Auth PostgreSQL] Created missing tables: ${createdTables.join(', ')}`);
    }
    this.repository = this.dataSource.getRepository(UserEntity);
    this.refreshTokenRepository =
      this.dataSource.getRepository(RefreshTokenEntity);
    this.sessionRepository = this.dataSource.getRepository(SessionEntity);
    console.log('🐘 [Auth PostgreSQL] users, sessions, and refresh_tokens tables are ready');
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

  async findAllPch(): Promise<UserEntity[]> {
    return this.repository.createQueryBuilder('user')
      .where('user.merchantId IS NULL')
      .andWhere('user.employeeId IS NULL')
      .andWhere('user.role IN (:...roles)', { roles: [UserRole.OWNER, UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.AGENT] })
      .orderBy('user.createdAt', 'DESC').getMany();
  }

  async createPch(dto: CreatePchUserDto, passwordHash: string): Promise<UserEntity> {
    if (await this.repository.createQueryBuilder('user').where('lower(user.email) = lower(:email)', { email: dto.email }).getExists()) {
      throw new ConflictException(`A user with email '${dto.email}' already exists`);
    }
    const username = dto.username.trim();
    if (await this.repository.createQueryBuilder('user').where('lower(user.username) = lower(:username)', { username }).getExists()) {
      throw new ConflictException(`A user with username '${username}' already exists`);
    }
    try {
      return await this.repository.save(this.repository.create({
        firstName: dto.first_name, lastName: dto.last_name, username,
        email: dto.email, phoneNumber: dto.phone_number, role: dto.role,
        status: UserStatus.ACTIVE, passwordHash,
      }));
    } catch (error: unknown) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505') {
        throw new ConflictException('Email or username already exists');
      }
      throw error;
    }
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

  async findByEmailWithPassword(email: string): Promise<UserEntity | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  async findByLoginWithPassword(login: string): Promise<UserEntity | null> {
    return this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('lower(user.email) = lower(:login) OR lower(user.username) = lower(:login)', { login })
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
