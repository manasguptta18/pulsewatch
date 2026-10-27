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

export async function changeUserPassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
): Promise<{ message: string }> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { password: true },
    });
    if (!user || !await bcrypt.compare(currentPassword, user.password)) {
        throw new AppError("Current password is incorrect", 400);
    }
    if (await bcrypt.compare(newPassword, user.password)) {
        throw new AppError("New password must be different", 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const updated = await prisma.user.updateMany({
        where: { id: userId, password: user.password },
        data: { password: passwordHash },
    });
    if (updated.count !== 1) {
        throw new AppError("Password changed during this request. Please try again", 409);
    }
    return { message: "Password updated" };
}
