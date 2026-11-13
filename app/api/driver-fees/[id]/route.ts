import {



  NextRequest,



  NextResponse,



} from "next/server";







import { getApps, cert } from "firebase-admin/app";



import { getFirestore, FieldValue } from "firebase-admin/firestore";



import { initializeApp } from "firebase-admin/app";







/* =========================================================



 * Firebase Admin



 * =======================================================*/







function getAdminDb() {



  if (!getApps().length) {



    const projectId =



      process.env.FIREBASE_PROJECT_ID ||



      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;







    const clientEmail =



      process.env.FIREBASE_CLIENT_EMAIL;







    const privateKey =



      process.env.FIREBASE_PRIVATE_KEY?.replace(



        /\\\\\n/g,



        "\n"



      );







    if (



      !projectId ||



      !clientEmail ||



      !privateKey



    ) {



      throw new Error(



        "Firebase Admin 環境變數尚未設定完整"



      );



    }







    initializeApp({



      credential: cert({



        projectId,



        clientEmail,



        privateKey,



      }),



    });



  }







  return getFirestore();



}







export const runtime = "nodejs";



export const dynamic = "force-dynamic";







/* =========================================================



 * 型別



 * =======================================================*/







type PaymentStatus =



  | "paid"



  | "partial"



  | "unpaid"



  | "waived";







type JoinFeeStatus =



  | "paid"



  | "unpaid"



  | "pending"



  | "waived";







type UpdateBody = {



  month?: string;







  monthlyFee?: number | string;







  paidAmount?: number | string;







  paymentStatus?: PaymentStatus;







  paymentMethod?: string;







  paymentDate?: string | null;







  note?: string;







  joinMonth?: string | null;







  joinedAt?: string | null;







  joinFee?: number | string;







  joinFeePaidAmount?: number | string;







  joinFeeStatus?: JoinFeeStatus;







  joinFeePaymentMethod?: string;







  joinFeePaymentDate?: string | null;



};







/* =========================================================



 * 共用工具



 * =======================================================*/







function cleanString(



  value: unknown



): string {



  if (



    value === null ||



    value === undefined



  ) {



    return "";



  }







  return String(value).trim();



}







function toNumber(



  value: unknown,



  fallback = 0



): number {



  if (



    value === null ||



    value === undefined ||



    value === ""



  ) {



    return fallback;



  }







  if (



    typeof value === "number"



  ) {



    return Number.isFinite(value)



      ? value



      : fallback;



  }







  const normalized =



    String(value)



      .replace(/,/g, "")



      .replace(/\\\\$/g, "")



      .replace(/NT\\\\$/gi, "")



      .trim();







  const number =



    Number(normalized);







  return Number.isFinite(number)



    ? number



    : fallback;



}







function isValidMonth(



  value: string



): boolean {



  return /^\d{4}-(0[1-9]|1[0-2])$/.test(



    value



  );



}







function isValidDate(



  value: string



): boolean {



  return /^\d{4}-\d{2}-\d{2}$/.test(



    value



  );



}







function getTaiwanDate(): string {



  return new Intl.DateTimeFormat(



    "en-CA",



    {



      timeZone: "Asia/Taipei",



      year: "numeric",



      month: "2-digit",



      day: "2-digit",



    }



  ).format(new Date());



}







function getTaiwanMonth(): string {



  return getTaiwanDate().slice(



    0,



    7



  );



}







/* =========================================================



 * 計算月費狀態



 * =======================================================*/







function calculatePaymentStatus(



  monthlyFee: number,



  paidAmount: number,



  requestedStatus?: PaymentStatus



): PaymentStatus {



  if (



    requestedStatus === "waived"



  ) {



    return "waived";



  }







  if (



    monthlyFee <= 0 &&



    paidAmount <= 0



  ) {



    return "waived";



  }







  if (



    paidAmount <= 0



  ) {



    return "unpaid";



  }







  if (



    paidAmount >= monthlyFee



  ) {



    return "paid";



  }







  return "partial";



}







/* =========================================================



 * 計算入會費狀態



 * =======================================================*/







function calculateJoinFeeStatus(



  joinFee: number,



  paidAmount: number,



  requestedStatus?: JoinFeeStatus



): JoinFeeStatus {



  if (



    requestedStatus === "pending"



  ) {



    return "pending";



  }







  if (



    requestedStatus === "waived"



  ) {



    return "waived";



  }







  if (



    joinFee <= 0 &&



    paidAmount <= 0



  ) {



    return "pending";



  }







  if (



    paidAmount >= joinFee &&



    joinFee > 0



  ) {



    return "paid";



  }







  return "unpaid";



}







/* =========================================================



 * GET



 *



 * 取得單一司機某月份月費紀錄



 *



 * /api/driver-fees/{driverId}?month=2026-09



 * =======================================================*/







export async function GET(



  request: NextRequest,



  context: {

    params: Promise<{ id: string }>;

  }



) {



  try {



    const params =

      await context.params;







    const driverId =



      cleanString(params.id);







    if (!driverId) {



      return NextResponse.json(



        {



          success: false,



          message:



            "缺少司機 ID",



        },



        {



          status: 400,



        }



      );



    }







    const searchParams =



      request.nextUrl.searchParams;







    const month =



      cleanString(



        searchParams.get("month")



      ) || getTaiwanMonth();







    if (!isValidMonth(month)) {



      return NextResponse.json(



        {



          success: false,



          message:



            "月份格式錯誤，例如：2026-09",



        },



        {



          status: 400,



        }



      );



    }







    const db =



      getAdminDb();







    /* =====================================================



     * 司機主檔



     * ===================================================*/







    const driverRef =



      db



        .collection("drivers")



        .doc(driverId);







    const driverSnap =



      await driverRef.get();







    if (!driverSnap.exists) {



      return NextResponse.json(



        {



          success: false,



          message:



            "找不到這位司機",



        },



        {



          status: 404,



        }



      );



    }







    const driver =



      driverSnap.data() || {};







    /* =====================================================



     * 當月月費紀錄



     * ===================================================*/







    const recordId =



      `${month}_${driverId}`;







    const recordRef =



      db



        .collection(



          "driverFeeRecords"



        )



        .doc(recordId);







    const recordSnap =



      await recordRef.get();







    const record =



      recordSnap.exists



        ? recordSnap.data() || {}



        : null;







    return NextResponse.json({



      success: true,







      driver: {



        id:



          driverSnap.id,







        ...driver,



      },







      month,







      record: record



        ? {



            id:



              recordSnap.id,







            ...record,



          }



        : null,



    });



  } catch (error) {



    console.error(



      "[driver-fees/id GET]",



      error



    );







    return NextResponse.json(



      {



        success: false,







        message:



          error instanceof Error



            ? error.message



            : "讀取月費紀錄失敗",



      },



      {



        status: 500,



      }



    );



  }



}







/* =========================================================



 * PATCH



 *



 * 更新單一司機的月費 / 入會費



 *



 * /api/driver-fees/{driverId}



 * =======================================================*/







export async function PATCH(



  request: NextRequest,



  context: {

    params: Promise<{ id: string }>;

  }



) {



  try {



    const params =

      await context.params;







    const driverId =



      cleanString(params.id);







    if (!driverId) {



      return NextResponse.json(



        {



          success: false,



          message:



            "缺少司機 ID",



        },



        {



          status: 400,



        }



      );



    }







    /* =====================================================



     * 解析 body



     * ===================================================*/







    let body: UpdateBody;







    try {



      body =



        (await request.json()) as UpdateBody;



    } catch {



      return NextResponse.json(



        {



          success: false,



          message:



            "JSON 格式錯誤",



        },



        {



          status: 400,



        }



      );



    }







    const month =



      cleanString(



        body.month



      ) || getTaiwanMonth();







    if (!isValidMonth(month)) {



      return NextResponse.json(



        {



          success: false,



          message:



            "月份格式錯誤，例如：2026-09",



        },



        {



          status: 400,



        }



      );



    }







    const db =



      getAdminDb();







    /* =====================================================



     * 取得司機



     * ===================================================*/







    const driverRef =



      db



        .collection("drivers")



        .doc(driverId);







    const driverSnap =



      await driverRef.get();







    if (!driverSnap.exists) {



      return NextResponse.json(



        {



          success: false,



          message:



            "找不到這位司機",



        },



        {



          status: 404,



        }



      );



    }







    const driverData =



      driverSnap.data() || {};







    /* =====================================================



     * 取得目前月費紀錄



     * ===================================================*/







    const recordId =



      `${month}_${driverId}`;







    const recordRef =



      db



        .collection(



          "driverFeeRecords"



        )



        .doc(recordId);







    const recordSnap =



      await recordRef.get();







    const oldRecord =



      recordSnap.exists



        ? recordSnap.data() || {}



        : {};







    /* =====================================================



     * 月費



     * ===================================================*/







    const monthlyFee =



      body.monthlyFee !== undefined



        ? Math.max(



            0,



            toNumber(



              body.monthlyFee



            )



          )



        : Math.max(



            0,



            toNumber(



              oldRecord.monthlyFee ??



                driverData.monthlyFee ??



                0



            )



          );







    let paidAmount =



      body.paidAmount !== undefined



        ? Math.max(



            0,



            toNumber(



              body.paidAmount



            )



          )



        : Math.max(



            0,



            toNumber(



              oldRecord.paidAmount ??



                0



            )



          );







    /*



     * 如果前端只傳：



     *



     * paymentStatus: "paid"



     *



     * 就自動把實收補成應繳金額。



     */



    if (



      body.paymentStatus ===



        "paid" &&



      body.paidAmount ===



        undefined



    ) {



      paidAmount =



        monthlyFee;



    }







    /*



     * 如果標記未繳，



     * 實收直接歸零。



     */



    if (



      body.paymentStatus ===



      "unpaid"



    ) {



      paidAmount = 0;



    }







    /*



     * 免繳不算欠款。



     */



    if (



      body.paymentStatus ===



      "waived"



    ) {



      paidAmount = 0;



    }







    const paymentStatus =



      calculatePaymentStatus(



        monthlyFee,



        paidAmount,



        body.paymentStatus



      );







    const isPaid =



      paymentStatus === "paid";







    const unpaidAmount =



      paymentStatus === "waived"



        ? 0



        : Math.max(



            monthlyFee -



              paidAmount,



            0



          );







    /* =====================================================



     * 繳費方式



     * ===================================================*/







    const paymentMethod =



      body.paymentMethod !==



      undefined



        ? cleanString(



            body.paymentMethod



          )



        : cleanString(



            oldRecord.paymentMethod



          );







    /* =====================================================



     * 繳費日期



     * ===================================================*/







    let paymentDate:



      | string



      | null =



      oldRecord.paymentDate ??



      null;







    if (



      body.paymentDate !==



      undefined



    ) {



      if (



        body.paymentDate ===



        null ||



        cleanString(



          body.paymentDate



        ) === ""



      ) {



        paymentDate = null;



      } else {



        const date =



          cleanString(



            body.paymentDate



          );







        if (!isValidDate(date)) {



          return NextResponse.json(



            {



              success: false,



              message:



                "繳費日期格式錯誤，例如：2026-09-19",



            },



            {



              status: 400,



            }



          );



        }







        paymentDate = date;



      }



    } else if (



      paymentStatus ===



        "paid" &&



      !paymentDate



    ) {



      paymentDate =



        getTaiwanDate();



    }







    if (



      paymentStatus ===



      "unpaid"



    ) {



      paymentDate = null;



    }







    /* =====================================================



     * 備註



     * ===================================================*/







    const note =



      body.note !== undefined



        ? cleanString(



            body.note



          )



        : cleanString(



            oldRecord.note



          );







    /* =====================================================



     * 寫入月費紀錄



     * ===================================================*/







    const recordPayload = {



      driverId,







      driverName:



        cleanString(



          driverData.name ??



            driverData.lineName



        ),







      lineName:



        cleanString(



          driverData.lineName ??



            driverData.name



        ),







      plate:



        cleanString(



          driverData.plate



        ),







      month,







      monthlyFee,







      expectedAmount:



        paymentStatus ===



        "waived"



          ? 0



          : monthlyFee,







      paidAmount,







      unpaidAmount,







      paid: isPaid,







      paymentStatus,







      paymentMethod,







      paymentDate,







      note,







      updatedAt:



        FieldValue.serverTimestamp(),



    };







    if (!recordSnap.exists) {



      Object.assign(



        recordPayload,



        {



          createdAt:



            FieldValue.serverTimestamp(),







          source:



            "manual",



        }



      );



    }







    await recordRef.set(



      recordPayload,



      {



        merge: true,



      }



    );







    /* =====================================================



     * 司機加入資料 / 入會費



     * ===================================================*/







    const driverUpdate:



      Record<string, unknown> = {



        updatedAt:



          FieldValue.serverTimestamp(),



      };







    /* -------------------------



     * 加入月份



     * -----------------------*/







    if (



      body.joinMonth !==



      undefined



    ) {



      if (



        body.joinMonth ===



        null ||



        cleanString(



          body.joinMonth



        ) === ""



      ) {



        driverUpdate.joinMonth =



          null;



      } else {



        const joinMonth =



          cleanString(



            body.joinMonth



          );







        if (



          !isValidMonth(



            joinMonth



          )



        ) {



          return NextResponse.json(



            {



              success: false,



              message:



                "加入月份格式錯誤，例如：2026-05",



            },



            {



              status: 400,



            }



          );



        }







        driverUpdate.joinMonth =



          joinMonth;



      }



    }







    /* -------------------------



     * 加入日期



     * -----------------------*/







    if (



      body.joinedAt !==



      undefined



    ) {



      if (



        body.joinedAt ===



        null ||



        cleanString(



          body.joinedAt



        ) === ""



      ) {



        driverUpdate.joinedAt =



          null;



      } else {



        const joinedAt =



          cleanString(



            body.joinedAt



          );







        if (



          !isValidDate(



            joinedAt



          )



        ) {



          return NextResponse.json(



            {



              success: false,



              message:



                "加入日期格式錯誤，例如：2026-05-01",



            },



            {



              status: 400,



            }



          );



        }







        driverUpdate.joinedAt =



          joinedAt;







        /*



         * 如果只填日期，



         * 自動補 joinMonth。



         */



        if (



          body.joinMonth ===



          undefined



        ) {



          driverUpdate.joinMonth =



            joinedAt.slice(



              0,



              7



            );



        }



      }



    }







    /* -------------------------



     * 入會費



     * -----------------------*/







    const joinFee =



      body.joinFee !== undefined



        ? Math.max(



            0,



            toNumber(



              body.joinFee



            )



          )



        : Math.max(



            0,



            toNumber(



              driverData.joinFee ??



                0



            )



          );







    let joinFeePaidAmount =



      body.joinFeePaidAmount !==



      undefined



        ? Math.max(



            0,



            toNumber(



              body.joinFeePaidAmount



            )



          )



        : Math.max(



            0,



            toNumber(



              driverData



                .joinFeePaidAmount ??



                0



            )



          );







    if (



      body.joinFeeStatus ===



        "paid" &&



      body.joinFeePaidAmount ===



        undefined



    ) {



      joinFeePaidAmount =



        joinFee;



    }







    if (



      body.joinFeeStatus ===



      "unpaid"



    ) {



      joinFeePaidAmount = 0;



    }







    if (



      body.joinFeeStatus ===



      "waived"



    ) {



      joinFeePaidAmount = 0;



    }







    const joinFeeStatus =



      calculateJoinFeeStatus(



        joinFee,



        joinFeePaidAmount,



        body.joinFeeStatus



      );







    /*



     * 只有前端有傳入會費相關欄位時，



     * 才修改司機主檔。



     *



     * 避免單純標記月費時，



     * 把舊司機入會費資料誤改掉。



     */



    const hasJoinFeeUpdate =



      body.joinFee !== undefined ||



      body.joinFeePaidAmount !==



        undefined ||



      body.joinFeeStatus !==



        undefined ||



      body.joinFeePaymentMethod !==



        undefined ||



      body.joinFeePaymentDate !==



        undefined;







    if (hasJoinFeeUpdate) {



      driverUpdate.joinFee =



        joinFee;







      driverUpdate.joinFeePaidAmount =



        joinFeePaidAmount;







      driverUpdate.joinFeeStatus =



        joinFeeStatus;







      driverUpdate.joinFeePaid =



        joinFeeStatus ===



        "paid";







      driverUpdate.joinFeeUnpaidAmount =



        joinFeeStatus ===



        "waived"



          ? 0



          : Math.max(



              joinFee -



                joinFeePaidAmount,



              0



            );







      if (



        body.joinFeePaymentMethod !==



        undefined



      ) {



        driverUpdate.joinFeePaymentMethod =



          cleanString(



            body.joinFeePaymentMethod



          );



      }







      if (



        body.joinFeePaymentDate !==



        undefined



      ) {



        if (



          body.joinFeePaymentDate ===



            null ||



          cleanString(



            body.joinFeePaymentDate



          ) === ""



        ) {



          driverUpdate.joinFeePaymentDate =



            null;



        } else {



          const joinFeeDate =



            cleanString(



              body.joinFeePaymentDate



            );







          if (



            !isValidDate(



              joinFeeDate



            )



          ) {



            return NextResponse.json(



              {



                success: false,



                message:



                  "入會費繳費日期格式錯誤",



              },



              {



                status: 400,



              }



            );



          }







          driverUpdate.joinFeePaymentDate =



            joinFeeDate;



        }



      } else if (



        joinFeeStatus ===



          "paid" &&



        !driverData



          .joinFeePaymentDate



      ) {



        driverUpdate.joinFeePaymentDate =



          getTaiwanDate();



      }



    }







    /* =====================================================



     * 更新司機主檔



     * ===================================================*/







    if (



      Object.keys(



        driverUpdate



      ).length > 1



    ) {



      await driverRef.set(



        driverUpdate,



        {



          merge: true,



        }



      );



    }







    /* =====================================================



     * 重新讀取



     * ===================================================*/







    const [



      updatedDriverSnap,



      updatedRecordSnap,



    ] = await Promise.all([



      driverRef.get(),



      recordRef.get(),



    ]);







    return NextResponse.json({



      success: true,







      message:



        paymentStatus === "paid"



          ? "已標記本月月費已繳"



          : paymentStatus ===



              "partial"



            ? "已更新部分繳費"



            : paymentStatus ===



                "waived"



              ? "已設定本月免繳"



              : "已標記本月月費未繳",







      driver: {



        id:



          updatedDriverSnap.id,







        ...(



          updatedDriverSnap.data() ||



          {}



        ),



      },







      record: {



        id:



          updatedRecordSnap.id,







        ...(



          updatedRecordSnap.data() ||



          {}



        ),



      },



    });



  } catch (error) {



    console.error(



      "[driver-fees/id PATCH]",



      error



    );







    return NextResponse.json(



      {



        success: false,







        message:



          error instanceof Error



            ? error.message



            : "更新月費紀錄失敗",



      },



      {



        status: 500,



      }



    );



  }



}







/* =========================================================



 * POST



 *



 * 提供前端快速操作



 *



 * action:



 *



 * markPaid



 * markUnpaid



 * markWaived



 * =======================================================*/







export async function POST(



  request: NextRequest,



  context: {

    params: Promise<{ id: string }>;

  }



) {



  try {



    const params =

      await context.params;







    const driverId =



      cleanString(params.id);







    if (!driverId) {



      return NextResponse.json(



        {



          success: false,



          message:



            "缺少司機 ID",



        },



        {



          status: 400,



        }



      );



    }







    const body =



      await request.json();







    const action =



      cleanString(



        body.action



      );







    const month =



      cleanString(



        body.month



      ) || getTaiwanMonth();







    if (!isValidMonth(month)) {



      return NextResponse.json(



        {



          success: false,



          message:



            "月份格式錯誤",



        },



        {



          status: 400,



        }



      );



    }







    const db =



      getAdminDb();







    const driverRef =



      db



        .collection("drivers")



        .doc(driverId);







    const driverSnap =



      await driverRef.get();







    if (!driverSnap.exists) {



      return NextResponse.json(



        {



          success: false,



          message:



            "找不到司機",



        },



        {



          status: 404,



        }



      );



    }







    const driver =



      driverSnap.data() || {};







    const recordId =



      `${month}_${driverId}`;







    const recordRef =



      db



        .collection(



          "driverFeeRecords"



        )



        .doc(recordId);







    const recordSnap =



      await recordRef.get();







    const oldRecord =



      recordSnap.exists



        ? recordSnap.data() || {}



        : {};







    const monthlyFee =



      Math.max(



        0,



        toNumber(



          body.monthlyFee ??



            oldRecord.monthlyFee ??



            driver.monthlyFee ??



            0



        )



      );







    /* =====================================================



     * 快速標記已繳



     * ===================================================*/







    if (



      action === "markPaid"



    ) {



      const paidAmount =



        body.paidAmount !==



        undefined



          ? Math.max(



              0,



              toNumber(



                body.paidAmount



              )



            )



          : monthlyFee;







      const paymentStatus =



        paidAmount >= monthlyFee



          ? "paid"



          : "partial";







      await recordRef.set(



        {



          driverId,







          driverName:



            cleanString(



              driver.name ??



                driver.lineName



            ),







          lineName:



            cleanString(



              driver.lineName ??



                driver.name



            ),







          plate:



            cleanString(



              driver.plate



            ),







          month,







          monthlyFee,







          expectedAmount:



            monthlyFee,







          paidAmount,







          unpaidAmount:



            Math.max(



              monthlyFee -



                paidAmount,



              0



            ),







          paid:



            paymentStatus ===



            "paid",







          paymentStatus,







          paymentMethod:



            cleanString(



              body.paymentMethod



            ),







          paymentDate:



            cleanString(



              body.paymentDate



            ) ||



            getTaiwanDate(),







          note:



            cleanString(



              body.note



            ),







          source:



            "manual",







          updatedAt:



            FieldValue.serverTimestamp(),







          ...(



            recordSnap.exists



              ? {}



              : {



                  createdAt:



                    FieldValue.serverTimestamp(),



                }



          ),



        },



        {



          merge: true,



        }



      );







      return NextResponse.json({



        success: true,







        message:



          paymentStatus ===



          "paid"



            ? "月費已標記為已繳"



            : "月費已標記為部分繳",







        paymentStatus,







        paidAmount,



      });



    }







    /* =====================================================



     * 快速標記未繳



     * ===================================================*/







    if (



      action === "markUnpaid"



    ) {



      await recordRef.set(



        {



          driverId,







          driverName:



            cleanString(



              driver.name ??



                driver.lineName



            ),







          lineName:



            cleanString(



              driver.lineName ??



                driver.name



            ),







          plate:



            cleanString(



              driver.plate



            ),







          month,







          monthlyFee,







          expectedAmount:



            monthlyFee,







          paidAmount: 0,







          unpaidAmount:



            monthlyFee,







          paid: false,







          paymentStatus:



            "unpaid",







          paymentMethod: "",







          paymentDate: null,







          source:



            "manual",







          updatedAt:



            FieldValue.serverTimestamp(),







          ...(



            recordSnap.exists



              ? {}



              : {



                  createdAt:



                    FieldValue.serverTimestamp(),



                }



          ),



        },



        {



          merge: true,



        }



      );







      return NextResponse.json({



        success: true,



        message:



          "月費已標記為未繳",



        paymentStatus:



          "unpaid",



      });



    }







    /* =====================================================



     * 快速設定免繳



     * ===================================================*/







    if (



      action === "markWaived"



    ) {



      await recordRef.set(



        {



          driverId,







          driverName:



            cleanString(



              driver.name ??



                driver.lineName



            ),







          lineName:



            cleanString(



              driver.lineName ??



                driver.name



            ),







          plate:



            cleanString(



              driver.plate



            ),







          month,







          monthlyFee,







          expectedAmount: 0,







          paidAmount: 0,







          unpaidAmount: 0,







          paid: false,







          paymentStatus:



            "waived",







          paymentMethod: "",







          paymentDate: null,







          note:



            cleanString(



              body.note



            ),







          source:



            "manual",







          updatedAt:



            FieldValue.serverTimestamp(),







          ...(



            recordSnap.exists



              ? {}



              : {



                  createdAt:



                    FieldValue.serverTimestamp(),



                }



          ),



        },



        {



          merge: true,



        }



      );







      return NextResponse.json({



        success: true,



        message:



          "本月已設定為免繳",



        paymentStatus:



          "waived",



      });



    }







    return NextResponse.json(



      {



        success: false,







        message:



          "不支援的 action，可使用 markPaid、markUnpaid、markWaived",



      },



      {



        status: 400,



      }



    );



  } catch (error) {



    console.error(



      "[driver-fees/id POST]",



      error



    );







    return NextResponse.json(



      {



        success: false,







        message:



          error instanceof Error



            ? error.message



            : "操作失敗",



      },



      {



        status: 500,



      }



    );



  }



}







/* =========================================================



 * DELETE



 *



 * 刪除指定司機「指定月份」的月費紀錄



 *



 * DELETE /api/driver-fees/{driverId}?month=2026-09



 *



 * 注意：



 * 1. 只刪除 driverFeeRecords 的當月紀錄



 * 2. 不刪除 drivers 司機主檔



 * 3. 不影響其他月份



 * 4. 相容舊資料：文件 ID 不一定是 month_driverId



 * =======================================================*/







export async function DELETE(



  request: NextRequest,



  context: {

    params: Promise<{ id: string }>;

  }



) {



  try {



    const params =

      await context.params;







    const driverId =



      cleanString(params.id);







    if (!driverId) {



      return NextResponse.json(



        {



          success: false,



          message: "缺少司機 ID",



        },



        {



          status: 400,



        }



      );



    }







    const searchParams =



      request.nextUrl.searchParams;







    const month =



      cleanString(



        searchParams.get("month")



      );







    if (!month) {



      return NextResponse.json(



        {



          success: false,



          message: "缺少月份",



        },



        {



          status: 400,



        }



      );



    }







    if (!isValidMonth(month)) {



      return NextResponse.json(



        {



          success: false,



          message:



            "月份格式錯誤，例如：2026-09",



        },



        {



          status: 400,



        }



      );



    }







    const db =



      getAdminDb();







    const collectionRef =



      db.collection(



        "driverFeeRecords"



      );







    /*



     * 第一種：



     * 新版標準文件 ID



     *



     * 2026-09_driverId



     */



    const standardRecordId =



      `${month}_${driverId}`;







    const standardRecordRef =



      collectionRef.doc(



        standardRecordId



      );







    const standardRecordSnap =



      await standardRecordRef.get();







    /*



     * 最後真正要刪除的文件。



     *



     * 先預設使用新版標準 ID。



     */



    let targetRef =



      standardRecordRef;







    let targetSnap =



      standardRecordSnap;







    /*



     * 如果標準 ID 找不到，



     * 代表可能是以前匯入的舊資料，



     * Firestore Document ID 並不是



     * `${month}_${driverId}`。



     *



     * 改用欄位：



     * month + driverId



     * 找真正的文件。



     */



    if (!targetSnap.exists) {



      const fallbackSnapshot =



        await collectionRef



          .where(



            "month",



            "==",



            month



          )



          .where(



            "driverId",



            "==",



            driverId



          )



          .limit(1)



          .get();







      if (!fallbackSnapshot.empty) {



        const fallbackDoc =



          fallbackSnapshot.docs[0];







        targetRef =



          fallbackDoc.ref;







        targetSnap =



          fallbackDoc;



      }



    }







    /*



     * 還是找不到時，



     * 再做一次相容處理：



     *



     * 有些舊資料 driverId 可能因為



     * 型別 / 空白 / 匯入方式不同，



     * 所以直接讀取該月份資料，



     * 用 cleanString 後再比對。



     *



     * 目前每月約數十筆，



     * 這個 fallback 成本很低，



     * 而且只有前兩種方式都找不到



     * 才會執行。



     */



    if (!targetSnap.exists) {



      const monthSnapshot =



        await collectionRef



          .where(



            "month",



            "==",



            month



          )



          .get();







      const fallbackDoc =



        monthSnapshot.docs.find(



          (doc) => {



            const data =



              doc.data() || {};







            return (



              cleanString(



                data.driverId



              ) === driverId



            );



          }



        );







      if (fallbackDoc) {



        targetRef =



          fallbackDoc.ref;







        targetSnap =



          fallbackDoc;



      }



    }







    if (!targetSnap.exists) {



      return NextResponse.json(



        {



          success: false,



          message:



            "找不到這位司機該月份的月費紀錄",



          driverId,



          month,



          attemptedRecordId:



            standardRecordId,



        },



        {



          status: 404,



        }



      );



    }







    const recordData =



      targetSnap.data() || {};







    const actualDriverId =



      cleanString(



        recordData.driverId



      ) || driverId;







    const driverName =



      cleanString(



        recordData.driverName ??



          recordData.lineName



      );







    const plate =



      cleanString(



        recordData.plate



      );







    const actualRecordId =



      targetSnap.id;







    /*



     * 只刪除這個月份的帳本紀錄。



     *



     * drivers 主檔完全不動。



     */



    await targetRef.delete();







    /*



     * 刪除後再驗證一次。



     */



    const verifySnap =



      await targetRef.get();







    if (verifySnap.exists) {



      throw new Error(



        "月費紀錄刪除後驗證失敗"



      );



    }







    return NextResponse.json(



      {



        success: true,







        message:



          `${driverName || "司機"} ${month} 月費紀錄已刪除`,







        deleted: {



          id: actualRecordId,



          requestedRecordId:



            standardRecordId,



          driverId:



            actualDriverId,



          driverName,



          plate,



          month,



        },







        driverDeleted: false,



      },



      {



        status: 200,







        headers: {



          "Cache-Control":



            "no-store, no-cache, must-revalidate",



        },



      }



    );



  } catch (error) {



    console.error(



      "[driver-fees/id DELETE]",



      error



    );







    return NextResponse.json(



      {



        success: false,







        message:



          error instanceof Error



            ? error.message



            : "刪除月費紀錄失敗",



      },



      {



        status: 500,



      }



    );



  }



}
