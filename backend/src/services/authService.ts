import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { UnauthorizedError } from '../domain/errors';
import { ROLES, type Actor, type Rol } from '../domain/types';
import type { UsuarioRepository } from '../repositories/interfaces';

export interface AuthOptions {
  jwtSecret: string;
  jwtExpiresIn: string;
  /** Factor de coste de bcrypt. 10-12 en produccion; las pruebas usan menos. */
  bcryptRounds?: number;
}

export interface SesionIniciada {
  token: string;
  tokenType: 'Bearer';
  expiresIn: string;
  usuario: Actor;
}

export class AuthService {
  private readonly rounds: number;
  private readonly hashFicticio: string;

  constructor(
    private readonly usuarios: UsuarioRepository,
    private readonly opciones: AuthOptions,
  ) {
    this.rounds = opciones.bcryptRounds ?? 12;
    // Se compara contra este hash cuando el usuario no existe, para que la
    // respuesta tarde lo mismo y no revele si el usuario existe.
    this.hashFicticio = bcrypt.hashSync('no-es-una-clave-real', this.rounds);
  }

  async login(username: string, password: string): Promise<SesionIniciada> {
    const usuario = await this.usuarios.buscarPorUsername(username);
    const hash = usuario?.passwordHash ?? this.hashFicticio;
    const coincide = await bcrypt.compare(password, hash);

    if (!usuario || !usuario.activo || !coincide) {
      // Mismo mensaje en todos los casos: no se filtra cual dato fallo.
      throw new UnauthorizedError('Usuario o contraseña incorrectos', 'CREDENCIALES_INVALIDAS');
    }

    const token = jwt.sign({ rol: usuario.rol }, this.opciones.jwtSecret, {
      algorithm: 'HS256',
      subject: usuario.username,
      expiresIn: this.opciones.jwtExpiresIn as SignOptions['expiresIn'],
    });

    return {
      token,
      tokenType: 'Bearer',
      expiresIn: this.opciones.jwtExpiresIn,
      usuario: { username: usuario.username, rol: usuario.rol },
    };
  }

  /** Valida firma, algoritmo y expiracion. Fija HS256 para impedir el ataque alg=none. */
  verificarToken(token: string): Actor {
    try {
      const payload = jwt.verify(token, this.opciones.jwtSecret, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || !payload.sub || !ROLES.includes(payload['rol'] as Rol)) {
        throw new Error('payload invalido');
      }
      return { username: payload.sub, rol: payload['rol'] as Rol };
    } catch {
      throw new UnauthorizedError('Token inválido o expirado', 'TOKEN_INVALIDO');
    }
  }

  /** Crea los usuarios iniciales solo si la tabla esta vacia. Devuelve cuantos creo. */
  async sembrarUsuarios(claves: { admin?: string | undefined; analista?: string | undefined }): Promise<number> {
    if ((await this.usuarios.contar()) > 0) return 0;
    let creados = 0;
    const iniciales: Array<{ username: string; rol: Rol; clave: string | undefined }> = [
      { username: 'admin', rol: 'ADMIN', clave: claves.admin },
      { username: 'analista', rol: 'ANALISTA', clave: claves.analista },
    ];
    for (const { username, rol, clave } of iniciales) {
      if (!clave) continue;
      await this.usuarios.crear({ username, rol, passwordHash: await bcrypt.hash(clave, this.rounds) });
      creados += 1;
    }
    return creados;
  }
}
