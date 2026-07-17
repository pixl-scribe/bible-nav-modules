import { importPKCS8, SignJWT } from 'jose';
import path from 'path';
import fs from 'fs';

export interface ModuleTokenPayload {
  [propName: string]: string | number;
  application: string;
  moduleId: string;
  moduleName: string;
  checksum: number;
}

export class JwtTokenService {
  public static async generateToken(
    payload: ModuleTokenPayload
  ): Promise<string> {
    const privateKeyFile = path.resolve('keys', `private.pem`);
    const privateKeyPem: string = fs.readFileSync(privateKeyFile, 'utf-8');

    try {
      const privateKey = await importPKCS8(privateKeyPem, 'RS256');

      return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256' })
        .setIssuedAt()
        .sign(privateKey);
    } catch (error) {
      console.error('Failed to sign JWT:', error);
      throw error;
    }
  }
}
