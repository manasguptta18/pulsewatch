import {prisma} from "../lib/prisma.js";

export async function createUser(data:{
    name: string;
    email: string;
    password: string;
}) {
    const user =  await prisma.user.create({
        data:{
            name: data.name,
            email: data.email,
            password: data.password,
        },
    });
    return user;
}