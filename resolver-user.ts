import {
  Resolver,
  Query,
  Arg,
  Mutation,
  Field,
  Ctx,
  ObjectType,
  FieldResolver,
} from 'type-graphql';
import UsernamePasswordInput from './UsernamePasswordInput';
import { createQueryBuilder, getConnection } from 'typeorm';
import bcrypt from 'bcrypt';
import { Context } from 'koa';
import redisStore from 'koa-redis';
import { v4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { uid } from 'rand-token';
import { validateRegister } from './validateRegister';
import { sendEmail } from '../../utils/sendEmail';
import User from '../../db/entities/user.entity';
import Country from '../../db/entities/country.entity';
import { EMAIL_TEMPLATE } from '../../utils/types';
import { FieldError } from '../../commonTypes/FieldError';

const FORGET_PASSWORD_PREFIX = 'forgotPassword';
const JWT_SECRET = process.env.SESSION_SECRET || 'jwt_secret';
const saltRounds = 10;

export type UserContext = {
  ctx: Context;
  redis: redisStore.RedisSessionStore;
};

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[];

  @Field(() => User, { nullable: true })
  user?: User;

  @Field(() => String, { nullable: true })
  token?: string;
}

@Resolver(User)
export class UserResolver {
  @FieldResolver(() => String)
  // query profile
  @Query(() => User, { nullable: true })
  async me(@Ctx() { ctx }: UserContext) {
    // you are not logged in
    if (!ctx.state.user) {
      return null;
    }
    const user = await createQueryBuilder(User, 'user')
      .leftJoinAndSelect('user.info', 'profile')
      .where('user.id = :id', {
        id: ctx.state.user.userId,
      })
      .getOne();

    return user;
  }

  @Query(() => [User], { nullable: true })
  async searchUser(@Arg('s') s: string): Promise<User[] | []> {
    let users = [];
    const words = s.split(' ');
    if (words.length === 2) {
      users = await createQueryBuilder(User, 'user')
        .leftJoinAndSelect('user.info', 'profile')
        .where(
          'LOWER(profile.first_name) = :first_name AND LOWER(profile.last_name) = :last_name AND user.role_id = :role_id',
          {
            first_name: words[0].toLowerCase(),
            last_name: words[1].toLowerCase(),
            role_id: 2,
          },
        )
        .getMany();
    } else {
      users = await createQueryBuilder(User, 'user')
        .leftJoinAndSelect('user.info', 'profile')
        .where('user.username like :s AND user.role_id = :role_id', {
          s: `%${s}%`,
          role_id: 2,
        })
        .orWhere(
          'LOWER(profile.first_name) like :s AND user.role_id = :role_id',
          {
            s: `%${s.toLowerCase()}%`,
            role_id: 2,
          },
        )
        .orWhere(
          'LOWER(profile.last_name) like :s AND user.role_id = :role_id',
          {
            s: `%${s.toLowerCase()}%`,
            role_id: 2,
          },
        )
        .getMany();
    }

    return users;
  }

  // query user by id
  @Query(() => User, { nullable: true })
  async userById(@Arg('id') id: number): Promise<User | undefined> {
    const user = await createQueryBuilder(User, 'user')
      .leftJoinAndSelect('user.info', 'profile')
      .where('user.id = :id', {
        id: id,
      })
      .getOne();

    return user;
  }

  // query user by username
  @Query(() => User, { nullable: true })
  async userByUsername(@Arg('username') username: string) {
    const basicInfo = await User.findOne({ where: { username } });
    let user;
    basicInfo
      ? (user = await createQueryBuilder(User, 'user')
          .leftJoinAndSelect('user.info', 'profile')
          .where('user.id = :id', {
            id: basicInfo.id,
          })
          .getOne())
      : (user = null);

    if (!!user && user.info && user.info.country) {
      const countryByCode = await Country.findOne({
        where: {
          code: user.info.country,
        },
      });
      user = {
        ...user,
        country: countryByCode,
      };
    }

    return user;
  }

  // List all users
  @Query(() => [User], { nullable: true })
  async userList(@Ctx() { ctx }: UserContext): Promise<User[] | null> {
    const users = await User.find();
    return users;
  }

  // refresh token
  @Query(() => UserResponse)
  async refreshToken(
    @Ctx() { ctx }: UserContext,
  ): Promise<UserResponse | null> {
    const refresh_token = ctx.cookies.get('refreshToken', { signed: true });
    if (!refresh_token) {
      return {
        errors: [
          {
            field: 'refreshToken',
            message: 'Invalid Refresh Token',
          },
        ],
      };
    }
    const user = await User.findOne({ where: { refresh_token } });
    if (!user || user.refresh_expires < new Date(Date.now())) {
      return {
        errors: [
          {
            field: 'refreshToken',
            message: 'Invalid Refresh Token',
          },
        ],
      };
    } else {
      const token = jwt.sign(
        {
          userId: user.id,
          userName: user.username,
          role: user.role_id,
          email: user.email,
        },
        JWT_SECRET,
        { expiresIn: 300 },
      );
      return {
        token,
      };
    }
    return null;
  }

  // account register
  @Mutation(() => UserResponse)
  async register(
    @Arg('options') options: UsernamePasswordInput,
    @Ctx() { ctx }: UserContext,
  ): Promise<UserResponse> {
    let user;
    let token;

    // validate user information are corect
    const errors = validateRegister(options);
    if (errors) {
      return { errors };
    }
    // check email
    const count = await User.count({
      where: {
        email: options.email,
      },
    });
    if (count > 0) {
      return {
        errors: [
          {
            field: 'email',
            message: 'The email already exists',
          },
        ],
      };
    } else {
      // check username
      const count = await User.count({
        where: {
          username: options.username,
        },
      });
      if (count > 0) {
        return {
          errors: [
            {
              field: 'username',
              message: 'The username already exists',
            },
          ],
        };
      } else {
        try {
          const salt = bcrypt.genSaltSync(saltRounds);
          const hashedPassword = bcrypt.hashSync(options.password, salt);
          const result = await getConnection()
            .createQueryBuilder()
            .insert()
            .into(User)
            .values({
              username: options.username,
              email: options.email,
              role_id: 2,
              password: hashedPassword,
            })
            .returning('*')
            .execute();
          user = result.raw[0];

          const refreshToken = uid(255);
          const isProd = process.env.NODE_ENV === 'production' ? true : false;
          const cookie_duration =
            Number(process.env.NOT_REMEMBER_ME_DURATION) || 5;
          token = jwt.sign(
            {
              userId: user.id,
              userName: user.username,
              role: user.role_id,
              email: user.email,
            },
            JWT_SECRET,
            { expiresIn: 300 },
          );

          ctx.cookies.set('refreshToken', refreshToken, {
            path: '/',
            maxAge: 1000 * 60 * 60 * 24 * cookie_duration,
            overwrite: true,
            httpOnly: !isProd,
            sameSite: 'lax',
            signed: true,
            secure: isProd,
            domain: process.env.DOMAIN || 'churdle.com',
          });

          await User.update(
            { id: user.id },
            {
              refresh_token: refreshToken,
              refresh_expires: new Date(
                Date.now() + 1000 * 60 * 60 * 24 * cookie_duration,
              ),
            },
          );
        } catch (err) {
          throw new Error(err);
        }
      }

      return { user, token };
    }
  }

  // acount login
  @Mutation(() => UserResponse)
  async login(
    @Arg('usernameOrEmail') usernameOrEmail: string,
    @Arg('password') password: string,
    @Arg('role_id', { defaultValue: 2, nullable: true }) role_id: number,
    @Arg('remember_me', { defaultValue: false, nullable: true })
    remember_me: boolean,
    @Ctx() { ctx }: UserContext,
  ): Promise<UserResponse> {
    const user = await User.findOne(
      usernameOrEmail.includes('@')
        ? { where: { email: usernameOrEmail, role_id: role_id } }
        : { where: { username: usernameOrEmail, role_id: role_id } },
    );
    if (user && Number(user.role_id) !== role_id) {
      return {
        errors: [
          {
            field: 'usernameOrEmail',
            message: 'Access denied.',
          },
        ],
      };
    }
    if (!user) {
      return {
        errors: [
          {
            field: 'usernameOrEmail',
            message: "Username doesn't exist",
          },
        ],
      };
    }
    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      return {
        errors: [
          {
            field: 'password',
            message: 'Incorrect password',
          },
        ],
      };
    }

    const refreshToken = uid(255);
    const isProd = process.env.NODE_ENV === 'production' ? true : false;
    const cookie_duration =
      Number(
        remember_me
          ? process.env.REMEMBER_ME_DURATION
          : process.env.NOT_REMEMBER_ME_DURATION,
      ) || 5;
    const token = jwt.sign(
      {
        userId: user.id,
        userName: user.username,
        role: user.role_id,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: 300 },
    );

    ctx.cookies.set('refreshToken', refreshToken, {
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * cookie_duration,
      overwrite: true,
      httpOnly: !isProd,
      sameSite: 'lax',
      signed: true,
      secure: isProd,
      domain: process.env.DOMAIN || 'churdle.com',
    });

    await User.update(
      { id: user.id },
      {
        refresh_token: refreshToken,
        refresh_expires: new Date(
          Date.now() + 1000 * 60 * 60 * 24 * cookie_duration,
        ),
      },
    );

    return {
      user,
      token,
    };
  }
  //forgot password
  @Mutation(() => Boolean)
  async forgotPassword(
    @Arg('email') email: string,
    @Ctx() { redis }: UserContext,
  ): Promise<boolean> {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return false;
    }

    const token = v4();
    const url = `${window.location.origin}/change-password/${token}`;
    try {
      await sendEmail({
        to: email,
        url,
        type: EMAIL_TEMPLATE.FORGOT_PASSWORD,
      });
    } catch (error) {
      console.log(error);
    }

    return true;
  }

  // confirm password
  @Mutation(() => UserResponse)
  async changePassword(
    @Arg('token') token: string,
    @Arg('newPassword') newPassword: string,
    @Ctx() { redis, ctx }: UserContext,
  ): Promise<UserResponse | null> {
    if (newPassword.length <= 3) {
      return {
        errors: [
          {
            field: 'newPassword',
            message: 'Length must be greater than 4',
          },
        ],
      };
    }

    const key = FORGET_PASSWORD_PREFIX + token;
    const userId = await redis.get(key, undefined, { rolling: undefined });
    if (!userId) {
      return {
        errors: [
          {
            field: 'token',
            message: 'token expired',
          },
        ],
      };
    }

    const userIdNum = userId;
    const user = await User.findOne(userIdNum);

    if (!user) {
      return {
        errors: [
          {
            field: 'token',
            message: 'user no longer exists',
          },
        ],
      };
    }
    const salt = bcrypt.genSaltSync(saltRounds);
    const hashedPassword = bcrypt.hashSync(newPassword, salt);
    await User.update(
      { id: userIdNum },
      {
        password: hashedPassword,
      },
    );

    await redis.destroy(key);

    // log in user after change password
    // TODO

    return { user };
  }

  @Mutation(() => Boolean)
  async logout(@Ctx() { ctx }: UserContext) {
    const userId = ctx.state.user.userId;
    if (!userId) {
      return {
        errors: [
          {
            field: 'usernameOrEmail',
            message: 'Invalid User',
          },
        ],
      };
    }
    const isProd = process.env.NODE_ENV === 'production' ? true : false;
    ctx.cookies.set('refreshToken', '', {
      httpOnly: !isProd,
      signed: true,
    });
    await User.update(
      { id: userId },
      {
        refresh_token: '',
        refresh_expires: new Date(Date.now() - 1),
      },
    );
    return true;
  }

  @Mutation(() => Boolean)
  async delete(
    @Arg('email') email: string,
    @Ctx() { ctx }: UserContext,
  ): Promise<boolean> {
    const user = await User.find({
      where: {
        email: email,
      },
    });
    await User.remove(user);
    return true;
  }

  @Mutation(() => UserResponse)
  async updateUser(
    @Arg('id') id: number,
    @Arg('email', { nullable: true }) email: string,
    @Arg('username', { nullable: true }) username: string,
    @Arg('role_id', { nullable: true }) role_id: number,
  ) {
    if (role_id) {
      await User.update(
        { id: id },
        {
          role_id: role_id === 1 ? 2 : 1,
        },
      );
    } else {
      await User.update(
        { id: id },
        {
          username: username,
          email: email,
        },
      );
    }
    const user = (await User.findOne(id)) as UserResponse;
    return {
      user,
    };
  }
}
