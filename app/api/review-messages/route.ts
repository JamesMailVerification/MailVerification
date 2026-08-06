import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { reviewMessages } from "../../../db/schema";

export const dynamic = "force-dynamic";
export async function GET() { const user = await getChatGPTUser(); if (!user) return NextResponse.json({ error:"AUTHENTICATION_REQUIRED" },{status:401}); return NextResponse.json({ messages: await getDb().select().from(reviewMessages).where(eq(reviewMessages.userId,user.userId)) }); }
export async function POST(request:Request) { const user=await getChatGPTUser(); if(!user)return NextResponse.json({error:"AUTHENTICATION_REQUIRED"},{status:401}); const m=await request.json() as Record<string,string>; const values={userId:user.userId,messageKey:m.messageKey,provider:m.provider||"gmail",subject:m.subject||"제목 없음",sender:m.from||m.sender||"",snippet:(m.snippet||"").slice(0,4000),sourceUrl:m.sourceUrl||"",receivedAt:m.receivedAt||"",accountEmail:m.accountEmail||""}; if(!values.messageKey)return NextResponse.json({error:"INVALID_MESSAGE"},{status:400}); await getDb().insert(reviewMessages).values(values).onConflictDoUpdate({target:[reviewMessages.userId,reviewMessages.messageKey],set:values}); return NextResponse.json({saved:true}); }
export async function DELETE(request:Request) { const user=await getChatGPTUser(); if(!user)return NextResponse.json({error:"AUTHENTICATION_REQUIRED"},{status:401}); const key=new URL(request.url).searchParams.get("key")||""; await getDb().delete(reviewMessages).where(and(eq(reviewMessages.userId,user.userId),eq(reviewMessages.messageKey,key))); return NextResponse.json({deleted:true}); }
