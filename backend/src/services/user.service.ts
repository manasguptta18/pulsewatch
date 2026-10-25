import {prisma} from "../lib/prisma.js";
import bcrypt from "bcrypt";
import { AppError } from "../errors/app-error.js";

function isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null &&
        "code" in error && error.code === "P2002";
}

export async function createUser(data:{
    name: string;
    email: string;
    password: string;
}) {
    const hashedPassword = await bcrypt.hash(
        data.password,
        10
    );
    
    let user;
    try {
        user = await prisma.user.create({
            data: {
                name: data.name,
                email: data.email,
                password: hashedPassword,
            },
        });
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            throw new AppError("An account with this email already exists", 409);
        }
        throw error;
    }

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
    };
}
