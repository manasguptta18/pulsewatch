import {prisma} from "../lib/prisma.js";
import bcrypt from "bcrypt";

export async function createUser(data:{
    name: string;
    email: string;
    password: string;
}) {
    const hashedPassword = await bcrypt.hash(
        data.password,
        10
    );
    
    const user =  await prisma.user.create({
        data:{
            name: data.name,
            email: data.email,
            password: hashedPassword,
        },
    });

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
    };
}