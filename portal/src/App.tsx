import { useState, useMemo, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { trpc } from "./lib/trpc";
import { format, eachDayOfInterval, isWithinInterval, addDays, differenceInDays, startOfDay, setHours, setMinutes } from "date-fns";
import { pl, enGB } from "date-fns/locale";
import { cn, getThumbnailUrl } from "./lib/utils";
import { 
  Home as HomeIcon,
  Calendar as CalendarIcon, 
  Users, 
  Phone, 
  Mail, 
  MapPin, 
  CheckCircle2, 
  ChevronRight,
  Menu,
  X,
  Languages,
  ArrowLeft,
  Waves,
  Trees,
  Bed,
  Share2,
  Camera,
  Baby,
  ImageIcon,
  Maximize2,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  Filter,
  Info,
  Map as MapIcon,
  ExternalLink,
  CalendarCheck2,
  CalendarX2,
  Dog
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import { Calendar } from "./components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "./components/ui/select";

// ─── Data ───────────────────────────────────────────────────────────────────

const HACJENDA_IMAGES = [
  "/images/Hacjenda/jadalnia/COS04034.jpg",
  "/images/Hacjenda/jadalnia/COS04107.jpg",
  "/images/Hacjenda/jadalnia/main.jpg",
  "/images/Hacjenda/łazienka dół/main.jpg",
  "/images/Hacjenda/main.jpg",
  "/images/Hacjenda/otoczenie/COS04087.jpg",
  "/images/Hacjenda/otoczenie/COS04091.jpg",
  "/images/Hacjenda/otoczenie/COS04092.jpg",
  "/images/Hacjenda/otoczenie/COS04113.jpg",
  "/images/Hacjenda/otoczenie/main.jpg",
  "/images/Hacjenda/salon/COS04020.jpg",
  "/images/Hacjenda/salon/COS04025.jpg",
  "/images/Hacjenda/salon/COS04026.jpg",
  "/images/Hacjenda/salon/COS04066.jpg",
  "/images/Hacjenda/salon/COS04073.jpg",
  "/images/Hacjenda/salon/COS04105.jpg",
  "/images/Hacjenda/salon/main.jpg",
  "/images/Hacjenda/sypialnia 1/main.jpg",
  "/images/Hacjenda/sypialnia 2/COS04082.jpg",
  "/images/Hacjenda/sypialnia 2/main.jpg",
  "/images/Hacjenda/taras/COS04015.jpg",
  "/images/Hacjenda/taras/COS04037.jpg",
  "/images/Hacjenda/taras/COS04038.jpg",
  "/images/Hacjenda/taras/COS04039.jpg",
  "/images/Hacjenda/taras/COS04042.jpg",
  "/images/Hacjenda/taras/COS04043.jpg",
  "/images/Hacjenda/taras/COS04047.jpg",
  "/images/Hacjenda/taras/COS04057.jpg",
  "/images/Hacjenda/taras/COS04060.jpg",
  "/images/Hacjenda/taras/COS04061.jpg",
  "/images/Hacjenda/taras/main.jpg",
  "/images/Hacjenda/toaleta/main.jpg"
];

const SADOLES_IMAGES = [
  "/images/Sadoles/kuchnia/IMG_8999.jpg",
  "/images/Sadoles/kuchnia/kuchnia 1.jpg",
  "/images/Sadoles/kuchnia/kuchnia 2.jpg",
  "/images/Sadoles/kuchnia/kuchnia 3.jpg",
  "/images/Sadoles/kuchnia/kuchnia 4.jpg",
  "/images/Sadoles/kuchnia/kuchnia 5.jpg",
  "/images/Sadoles/kuchnia/kuchnia 6.jpg",
  "/images/Sadoles/kuchnia/MAIN.jpg",
  "/images/Sadoles/łazienka dolna/DSC_4556.jpg",
  "/images/Sadoles/łazienka dolna/IMG_4055.jpg",
  "/images/Sadoles/łazienka dolna/IMG_4056.jpg",
  "/images/Sadoles/łazienka dolna/IMG_4057.jpg",
  "/images/Sadoles/łazienka dolna/IMG_4058.jpg",
  "/images/Sadoles/łazienka dolna/IMG_4059.jpg",
  "/images/Sadoles/łazienka dolna/IMG_8926.jpg",
  "/images/Sadoles/łazienka dolna/IMG_8929.jpg",
  "/images/Sadoles/łazienka dolna/IMG_8933.jpg",
  "/images/Sadoles/łazienka dolna/IMG_8937.jpg",
  "/images/Sadoles/łazienka dolna/IMG_8941.jpg",
  "/images/Sadoles/łazienka dolna/lazienka dol 1.jpg",
  "/images/Sadoles/łazienka dolna/lazienka dol 2.jpg",
  "/images/Sadoles/łazienka dolna/lazienka dol 3.jpg",
  "/images/Sadoles/łazienka dolna/MAIN.jpg",
  "/images/Sadoles/łazienka górna/0S3A5624.jpg",
  "/images/Sadoles/łazienka górna/0S3A5625.jpg",
  "/images/Sadoles/łazienka górna/0S3A5639.jpg",
  "/images/Sadoles/łazienka górna/0S3A5644.jpg",
  "/images/Sadoles/łazienka górna/IMG_8923.jpg",
  "/images/Sadoles/łazienka górna/IMG_8957.jpg",
  "/images/Sadoles/łazienka górna/IMG_8958.jpg",
  "/images/Sadoles/łazienka górna/IMG_8960.jpg",
  "/images/Sadoles/łazienka górna/IMG_8961.jpg",
  "/images/Sadoles/łazienka górna/IMG_8962.jpg",
  "/images/Sadoles/łazienka górna/IMG_8966.jpg",
  "/images/Sadoles/łazienka górna/IMG_8967.jpg",
  "/images/Sadoles/łazienka górna/lazienka gora 2.jpg",
  "/images/Sadoles/łazienka górna/lazienka gora 3.jpg",
  "/images/Sadoles/łazienka górna/MAIN.jpg",
  "/images/Sadoles/MAIN.jpg",
  "/images/Sadoles/otoczenie/0S3A6967.jpg",
  "/images/Sadoles/otoczenie/0S3A6969.jpg",
  "/images/Sadoles/otoczenie/0S3A6970.jpg",
  "/images/Sadoles/otoczenie/0S3A6971.jpg",
  "/images/Sadoles/otoczenie/0S3A6972.jpg",
  "/images/Sadoles/otoczenie/0S3A6973.jpg",
  "/images/Sadoles/otoczenie/0S3A6974.jpg",
  "/images/Sadoles/otoczenie/0S3A6976.jpg",
  "/images/Sadoles/otoczenie/0S3A6979.jpg",
  "/images/Sadoles/otoczenie/0S3A6980.jpg",
  "/images/Sadoles/otoczenie/0S3A6981.jpg",
  "/images/Sadoles/otoczenie/0S3A6982.jpg",
  "/images/Sadoles/otoczenie/0S3A6983.jpg",
  "/images/Sadoles/otoczenie/0S3A6984.jpg",
  "/images/Sadoles/otoczenie/0S3A6985.jpg",
  "/images/Sadoles/otoczenie/0S3A6986.jpg",
  "/images/Sadoles/otoczenie/0S3A6987.jpg",
  "/images/Sadoles/otoczenie/0S3A6988.jpg",
  "/images/Sadoles/otoczenie/0S3A6989.jpg",
  "/images/Sadoles/otoczenie/0S3A6990.jpg",
  "/images/Sadoles/otoczenie/0S3A6991.jpg",
  "/images/Sadoles/otoczenie/0S3A6992.jpg",
  "/images/Sadoles/otoczenie/0S3A6995.jpg",
  "/images/Sadoles/otoczenie/0S3A6997.jpg",
  "/images/Sadoles/otoczenie/0S3A6998.jpg",
  "/images/Sadoles/otoczenie/0S3A6999.jpg",
  "/images/Sadoles/otoczenie/0S3A7000.jpg",
  "/images/Sadoles/otoczenie/0S3A7001.jpg",
  "/images/Sadoles/otoczenie/0S3A7003.jpg",
  "/images/Sadoles/otoczenie/0S3A7004.jpg",
  "/images/Sadoles/otoczenie/0S3A7005.jpg",
  "/images/Sadoles/otoczenie/0S3A7006.jpg",
  "/images/Sadoles/otoczenie/0S3A7007.jpg",
  "/images/Sadoles/otoczenie/0S3A7012.jpg",
  "/images/Sadoles/otoczenie/0S3A7014.jpg",
  "/images/Sadoles/otoczenie/0S3A7015.jpg",
  "/images/Sadoles/otoczenie/0S3A7016.jpg",
  "/images/Sadoles/otoczenie/0S3A7020.jpg",
  "/images/Sadoles/otoczenie/0S3A7021.jpg",
  "/images/Sadoles/otoczenie/DJI_0343.jpg",
  "/images/Sadoles/otoczenie/DJI_0344.jpg",
  "/images/Sadoles/otoczenie/DJI_0345.jpg",
  "/images/Sadoles/otoczenie/DJI_0346.jpg",
  "/images/Sadoles/otoczenie/DJI_0347.jpg",
  "/images/Sadoles/otoczenie/DJI_0348.jpg",
  "/images/Sadoles/otoczenie/DJI_0350.jpg",
  "/images/Sadoles/otoczenie/DJI_0351.jpg",
  "/images/Sadoles/otoczenie/DJI_0353.jpg",
  "/images/Sadoles/otoczenie/DJI_0354.jpg",
  "/images/Sadoles/otoczenie/DJI_0355.jpg",
  "/images/Sadoles/otoczenie/DJI_0356.jpg",
  "/images/Sadoles/otoczenie/DJI_0357.jpg",
  "/images/Sadoles/otoczenie/DJI_0359.jpg",
  "/images/Sadoles/otoczenie/DJI_0360.jpg",
  "/images/Sadoles/otoczenie/DJI_0361.jpg",
  "/images/Sadoles/otoczenie/DJI_0362.jpg",
  "/images/Sadoles/otoczenie/DJI_0363.jpg",
  "/images/Sadoles/otoczenie/DJI_0365.jpg",
  "/images/Sadoles/otoczenie/DJI_0366.jpg",
  "/images/Sadoles/otoczenie/DJI_0367.jpg",
  "/images/Sadoles/otoczenie/DJI_0368.jpg",
  "/images/Sadoles/otoczenie/DJI_0369.jpg",
  "/images/Sadoles/otoczenie/DJI_0370.jpg",
  "/images/Sadoles/otoczenie/DJI_0371.jpg",
  "/images/Sadoles/otoczenie/DJI_0372.jpg",
  "/images/Sadoles/otoczenie/DJI_0373.jpg",
  "/images/Sadoles/otoczenie/DJI_0374.jpg",
  "/images/Sadoles/otoczenie/DJI_0375.jpg",
  "/images/Sadoles/otoczenie/DJI_0376.jpg",
  "/images/Sadoles/otoczenie/hustawka.jpg",
  "/images/Sadoles/otoczenie/IMG_5157.jpg",
  "/images/Sadoles/otoczenie/IMG_5158.jpg",
  "/images/Sadoles/otoczenie/IMG_5237.jpg",
  "/images/Sadoles/otoczenie/IMG_5244.jpg",
  "/images/Sadoles/otoczenie/IMG_5246.jpg",
  "/images/Sadoles/otoczenie/IMG_5282.jpg",
  "/images/Sadoles/otoczenie/IMG_5307.jpg",
  "/images/Sadoles/otoczenie/IMG_5308.jpg",
  "/images/Sadoles/otoczenie/IMG_6099.jpg",
  "/images/Sadoles/otoczenie/IMG_6101.jpg",
  "/images/Sadoles/otoczenie/IMG_6103.jpg",
  "/images/Sadoles/otoczenie/IMG_6104.jpg",
  "/images/Sadoles/otoczenie/IMG_6105.jpg",
  "/images/Sadoles/otoczenie/IMG_6106.jpg",
  "/images/Sadoles/otoczenie/IMG_6107.jpg",
  "/images/Sadoles/otoczenie/IMG_6108.jpg",
  "/images/Sadoles/otoczenie/IMG_6109.jpg",
  "/images/Sadoles/otoczenie/IMG_6110.jpg",
  "/images/Sadoles/otoczenie/IMG_6111(1).jpg",
  "/images/Sadoles/otoczenie/IMG_6112.jpg",
  "/images/Sadoles/otoczenie/IMG_6113.jpg",
  "/images/Sadoles/otoczenie/IMG_6115.jpg",
  "/images/Sadoles/otoczenie/IMG_8854.jpg",
  "/images/Sadoles/otoczenie/IMG_8855.jpg",
  "/images/Sadoles/otoczenie/IMG_8859.jpg",
  "/images/Sadoles/otoczenie/IMG_8874.jpg",
  "/images/Sadoles/otoczenie/IMG_8877.jpg",
  "/images/Sadoles/otoczenie/IMG_8879.jpg",
  "/images/Sadoles/otoczenie/IMG_8880.jpg",
  "/images/Sadoles/otoczenie/IMG_8887.jpg",
  "/images/Sadoles/otoczenie/IMG_8982.jpg",
  "/images/Sadoles/otoczenie/IMG_8985.jpg",
  "/images/Sadoles/otoczenie/IMG_9124.jpg",
  "/images/Sadoles/otoczenie/IMG_9125.jpg",
  "/images/Sadoles/otoczenie/IMG_9126.jpg",
  "/images/Sadoles/otoczenie/IMG_9127.jpg",
  "/images/Sadoles/otoczenie/IMG_9128.jpg",
  "/images/Sadoles/otoczenie/IMG_9129.jpg",
  "/images/Sadoles/otoczenie/IMG_9130.jpg",
  "/images/Sadoles/otoczenie/IMG_9131.jpg",
  "/images/Sadoles/otoczenie/IMG_9132.jpg",
  "/images/Sadoles/otoczenie/IMG_9173.jpg",
  "/images/Sadoles/otoczenie/IMG_9174.jpg",
  "/images/Sadoles/otoczenie/IMG_9175.jpg",
  "/images/Sadoles/otoczenie/IMG_9178.jpg",
  "/images/Sadoles/otoczenie/IMG_9179.jpg",
  "/images/Sadoles/otoczenie/IMG_9180.jpg",
  "/images/Sadoles/otoczenie/MAIN.jpg",
  "/images/Sadoles/otoczenie/zima.jpg",
  "/images/Sadoles/otoczenie/zimowe katalogowe.jpeg",
  "/images/Sadoles/salon/0S3A5663.jpg",
  "/images/Sadoles/salon/0S3A5664.jpg",
  "/images/Sadoles/salon/0S3A5670.jpg",
  "/images/Sadoles/salon/5D14AF1F-4A62-486D-83DD-5E3533D431C3.JPG",
  "/images/Sadoles/salon/DSC_4485.jpg",
  "/images/Sadoles/salon/DSC_4524.jpg",
  "/images/Sadoles/salon/DSC_4528.jpg",
  "/images/Sadoles/salon/DSC_4531.jpg",
  "/images/Sadoles/salon/DSC_4536.jpg",
  "/images/Sadoles/salon/DSC_4549.jpg",
  "/images/Sadoles/salon/DSC_4572.jpg",
  "/images/Sadoles/salon/DSC_4594.jpg",
  "/images/Sadoles/salon/DSC_4607.jpg",
  "/images/Sadoles/salon/DSC_4619.jpg",
  "/images/Sadoles/salon/DSC_4620.jpg",
  "/images/Sadoles/salon/IMG_4048.jpg",
  "/images/Sadoles/salon/IMG_5239.jpg",
  "/images/Sadoles/salon/IMG_9012.jpg",
  "/images/Sadoles/salon/IMG_9015.jpg",
  "/images/Sadoles/salon/IMG_9017.jpg",
  "/images/Sadoles/salon/IMG_9022.jpg",
  "/images/Sadoles/salon/IMG_9154.jpg",
  "/images/Sadoles/salon/IMG_9157.jpg",
  "/images/Sadoles/salon/IMG_9158.jpg",
  "/images/Sadoles/salon/MAIN.jpg",
  "/images/Sadoles/salon/pilkarzyki.jpg",
  "/images/Sadoles/salon/przedpokoj.jpg",
  "/images/Sadoles/salon/salon 1.jpg",
  "/images/Sadoles/salon/salon 2.jpg",
  "/images/Sadoles/salon/salon 3.jpg",
  "/images/Sadoles/salon/salon 4.jpg",
  "/images/Sadoles/salon/salon 5.jpg",
  "/images/Sadoles/salon/salon 6.jpg",
  "/images/Sadoles/salon/salon 7.jpg",
  "/images/Sadoles/salon/salon 8.jpg",
  "/images/Sadoles/salon/salon 9.jpg",
  "/images/Sadoles/sypialnia brązowa/DSC_4494.jpg",
  "/images/Sadoles/sypialnia brązowa/DSC_4539.jpg",
  "/images/Sadoles/sypialnia brązowa/DSC_4579.jpg",
  "/images/Sadoles/sypialnia brązowa/DSC_4583.jpg",
  "/images/Sadoles/sypialnia brązowa/IMG_4049.jpg",
  "/images/Sadoles/sypialnia brązowa/IMG_4050.jpg",
  "/images/Sadoles/sypialnia brązowa/IMG_4051.jpg",
  "/images/Sadoles/sypialnia brązowa/IMG_4052.jpg",
  "/images/Sadoles/sypialnia brązowa/IMG_8906.jpg",
  "/images/Sadoles/sypialnia brązowa/IMG_8971.jpg",
  "/images/Sadoles/sypialnia brązowa/IMG_8973.jpg",
  "/images/Sadoles/sypialnia brązowa/MASTER.jpg",
  "/images/Sadoles/sypialnia brązowa/s lech 1.jpg",
  "/images/Sadoles/sypialnia brązowa/s lech 3.jpg",
  "/images/Sadoles/sypialnia czarna/IMG_5252.jpg",
  "/images/Sadoles/sypialnia czarna/IMG_5259.jpg",
  "/images/Sadoles/sypialnia czarna/IMG_5264.jpg",
  "/images/Sadoles/sypialnia czarna/IMG_5265.jpg",
  "/images/Sadoles/sypialnia czarna/MAIN.jpg",
  "/images/Sadoles/sypialnia czarna/s czarna 1.jpg",
  "/images/Sadoles/sypialnia czarna/s czarna 2.jpg",
  "/images/Sadoles/sypialnia czarna/s czarna 3.jpg",
  "/images/Sadoles/sypialnia czarna/s czarna 4.jpg",
  "/images/Sadoles/sypialnia master/IMG_5296.jpg",
  "/images/Sadoles/sypialnia master/IMG_5329.jpg",
  "/images/Sadoles/sypialnia master/IMG_8981.jpg",
  "/images/Sadoles/sypialnia master/main.jpg",
  "/images/Sadoles/sypialnia master/s master 1.jpg",
  "/images/Sadoles/sypialnia master/s master 2.jpg",
  "/images/Sadoles/sypialnia master/s master 3.jpg",
  "/images/Sadoles/sypialnia master/s master 4 (4667x7000).jpg",
  "/images/Sadoles/sypialnia master/s master 5.jpg",
  "/images/Sadoles/sypialnia master/s master 6.jpg",
  "/images/Sadoles/sypialnia master/workation z laptopem.jpg",
  "/images/Sadoles/sypialnia niebieska/0S3A5672.jpg",
  "/images/Sadoles/sypialnia niebieska/0S3A5674.jpg",
  "/images/Sadoles/sypialnia niebieska/IMG_4054.jpg",
  "/images/Sadoles/sypialnia niebieska/IMG_5293.jpg",
  "/images/Sadoles/sypialnia niebieska/IMG_5327.jpg",
  "/images/Sadoles/sypialnia niebieska/IMG_8948.jpg",
  "/images/Sadoles/sypialnia niebieska/IMG_8974.jpg",
  "/images/Sadoles/sypialnia niebieska/MAIN.jpg",
  "/images/Sadoles/sypialnia niebieska/s furtak 1.jpg",
  "/images/Sadoles/sypialnia niebieska/s furtak 2.jpg",
  "/images/Sadoles/sypialnia niebieska/s furtak 3.jpg",
  "/images/Sadoles/sypialnia złota/0S3A5645.jpg",
  "/images/Sadoles/sypialnia złota/0S3A5651.jpg",
  "/images/Sadoles/sypialnia złota/0S3A5652.jpg",
  "/images/Sadoles/sypialnia złota/DSC_4499.jpg",
  "/images/Sadoles/sypialnia złota/DSC_4507.jpg",
  "/images/Sadoles/sypialnia złota/DSC_4510.jpg",
  "/images/Sadoles/sypialnia złota/DSC_4515.jpg",
  "/images/Sadoles/sypialnia złota/DSC_4521.jpg",
  "/images/Sadoles/sypialnia złota/IMG_5269.jpg",
  "/images/Sadoles/sypialnia złota/IMG_5273.jpg",
  "/images/Sadoles/sypialnia złota/IMG_5274.jpg",
  "/images/Sadoles/sypialnia złota/IMG_5277.jpg",
  "/images/Sadoles/sypialnia złota/IMG_5280.jpg",
  "/images/Sadoles/sypialnia złota/IMG_5281.jpg",
  "/images/Sadoles/sypialnia złota/master.jpg",
  "/images/Sadoles/sypialnia złota/s zlota 1.jpg",
  "/images/Sadoles/sypialnia złota/s zlota 2.jpg",
  "/images/Sadoles/sypialnia złota/s zlota 3.jpg",
  "/images/Sadoles/sypialnia złota/s zlota 4.jpg",
  "/images/Sadoles/sypialnia złota/s zlota 5.jpg",
  "/images/Sadoles/wejście/0S3A5682.jpg",
  "/images/Sadoles/wejście/0S3A5688.jpg",
  "/images/Sadoles/wejście/IMG_8893.jpg",
  "/images/Sadoles/wejście/IMG_8899.jpg",
  "/images/Sadoles/wejście/master.jpg"
];

const PROPERTIES_DATA = {
  Hacjenda: {
    mainImg: "/images/Hacjenda/main.jpg",
    allImages: HACJENDA_IMAGES,
    address: "ul. Wilków Morskich 66, 60-480 Poznań, Poland",
    mapEmbed: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2430.34211116035!2d16.7844005!3d52.4727821!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x4704433159074061%3A0xc3f66a7b27076b42!2zV2lsa8OzdyBNb3Jza2ljaCA2NiwgNjAtNDgwIFBvem5hxYQsIFBvbGFuZA!5e0!3m2!1sen!2spl!4v1711460000000!5m2!1sen!2spl",
    mapLink: "https://maps.app.goo.gl/K8n5K9X6m9n1q4mS1",
    bedrooms: [
      {
        id: "h1",
        folder: "sypialnia 2",
        name: { PL: "Sypialnia 1 (pokój dwuczęściowy)", EN: "Bedroom 1 (two-section room)" },
        beds: { PL: "1 łóżko podwójne, 1 łóżko pojedyncze, opcjonalnie: pojedynczy materac", EN: "1 double bed, 1 single bed, optional: single mattress" },
        img: "/images/Hacjenda/sypialnia 2/main.jpg"
      },
      {
        id: "h2",
        folder: "sypialnia 1",
        name: { PL: "Sypialnia 2", EN: "Bedroom 2" },
        beds: { PL: "1 łóżko typu queen", EN: "1 queen bed" },
        img: "/images/Hacjenda/sypialnia 1/main.jpg"
      }
    ],
    otherAreas: [
      { id: "ha1", folder: "salon", name: { PL: "Salon", EN: "Living Room" }, img: "/images/Hacjenda/salon/main.jpg" },
      { id: "ha2", folder: "jadalnia", name: { PL: "Jadalnia", EN: "Dining Room" }, img: "/images/Hacjenda/jadalnia/main.jpg" },
      { id: "ha3", folder: "taras", name: { PL: "Taras", EN: "Terrace" }, img: "/images/Hacjenda/taras/main.jpg" },
      { id: "ha4", folder: "otoczenie", name: { PL: "Otoczenie", EN: "Surroundings" }, img: "/images/Hacjenda/otoczenie/main.jpg" },
      { id: "ha5", folder: "łazienka dół", name: { PL: "Łazienka dół", EN: "Downstairs Bathroom" }, img: "/images/Hacjenda/łazienka dół/main.jpg" },
      { id: "ha6", folder: "toaleta", name: { PL: "Toaleta", EN: "Toilet" }, img: "/images/Hacjenda/toaleta/main.jpg" }
    ],
    social: {
      fb: "https://facebook.com/hacjenda.kiekrz",
      ig: "https://instagram.com/hacjenda.kiekrz"
    },
    maxGuests: 7
  },
  Sadoles: {
    mainImg: "/images/Sadoles/otoczenie/MAIN.jpg",
    allImages: SADOLES_IMAGES,
    address: "Sadoleś 66, 07-140 Sadoleś, Poland",
    mapEmbed: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2424.4635671561545!2d21.8728!3d52.6617!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x471f45607b36f7e9%3A0x6a2b8e39f37c5980!2zU2Fkb2xlxZsgNjYsIDA3LTE0MCBTYWRvbGXFmSwgUG9sYW5k!5e0!3m2!1sen!2spl!4v1711460000000!5m2!1sen!2spl",
    mapLink: "https://maps.app.goo.gl/B9p5K9X6m9n1q4mS9",
    bedrooms: [
      {
        id: "s1",
        folder: "sypialnia master",
        name: { PL: "Sypialnia Master", EN: "Master Bedroom" },
        beds: { PL: "1 łóżko typu king", EN: "1 king bed" },
        img: "/images/Sadoles/sypialnia master/main.jpg"
      },
      {
        id: "s2",
        folder: "sypialnia złota",
        name: { PL: "Sypialnia Złota", EN: "Golden Bedroom" },
        beds: { PL: "1 łóżko podwójne, 1 łóżeczko dziecięce", EN: "1 double bed, 1 crib" },
        img: "/images/Sadoles/sypialnia złota/master.jpg"
      },
      {
        id: "s3",
        folder: "sypialnia niebieska",
        name: { PL: "Sypialnia Niebieska", EN: "Blue Bedroom" },
        beds: { PL: "1 łóżko typu queen, 1 materac na podłodze", EN: "1 queen bed, 1 floor mattress" },
        img: "/images/Sadoles/sypialnia niebieska/MAIN.jpg"
      },
      {
        id: "s4",
        folder: "sypialnia brązowa",
        name: { PL: "Sypialnia Brązowa", EN: "Brown Bedroom" },
        beds: { PL: "1 łóżko typu queen, 1 rozkładana sofa", EN: "1 queen bed, 1 sofa bed" },
        img: "/images/Sadoles/sypialnia brązowa/MASTER.jpg"
      },
      {
        id: "s5",
        folder: "sypialnia czarna",
        name: { PL: "Sypialnia Black", EN: "Black Bedroom" },
        beds: { PL: "1 łóżko podwójne, 1 rozkładana sofa", EN: "1 double bed, 1 sofa bed" },
        img: "/images/Sadoles/sypialnia czarna/MAIN.jpg"
      }
    ],
    otherAreas: [
      { id: "sa1", folder: "salon", name: { PL: "Salon", EN: "Living Room" }, img: "/images/Sadoles/salon/MAIN.jpg" },
      { id: "sa2", folder: "kuchnia", name: { PL: "Kuchnia", EN: "Kitchen" }, img: "/images/Sadoles/kuchnia/MAIN.jpg" },
      { id: "sa3", folder: "otoczenie", name: { PL: "Otoczenie", EN: "Surroundings" }, img: "/images/Sadoles/otoczenie/MAIN.jpg" },
      { id: "sa4", folder: "wejście", name: { PL: "Wejście", EN: "Entrance" }, img: "/images/Sadoles/wejście/master.jpg" },
      { id: "sa5", folder: "łazienka dolna", name: { PL: "Łazienka dolna", EN: "Lower Bathroom" }, img: "/images/Sadoles/łazienka dolna/MAIN.jpg" },
      { id: "sa6", folder: "łazienka górna", name: { PL: "Łazienka górna", EN: "Upper Bathroom" }, img: "/images/Sadoles/łazienka górna/MAIN.jpg" }
    ],
    social: {
      fb: "https://facebook.com/sadoles66",
      ig: "https://instagram.com/sadoles66"
    },
    maxGuests: 15
  }
};

// ─── Translations ─────────────────────────────────────────────────────────────

type Lang = "PL" | "EN";

const T = {
  PL: {
    document_title: "Zarezerwuj pobyt",
    header_title: "Nasz-bnb",
    footer_desc: "Dwie wyjątkowe nieruchomości zaprojektowane dla powolnego życia i kontaktu z naturą.",
    about_us: "O nas",
    contact: "Kontakt",
    hero_title: "Zarezerwuj swój pobyt",
    hero_subtitle: "Dwa wyjątkowe miejsca, dwa różne charaktery. Wybierz swój odpoczynek.",
    book_now: "Zarezerwuj teraz",
    back: "Wróć",
    availability: "Dostępność",
    total_price: "Cena całkowita",
    nights: "noce",
    per_night: "za noc",
    hacjenda_title: "Hacjenda Kiekrz",
    hacjenda_tag: "Modernistyczna willa nad jeziorem",
    hacjenda_desc: "Wyjątkowa, modernistyczna willa z lat 70. położona bezpośrednio nad brzegiem Jeziora Kierskiego. Dom z duszą, atlantycką ceramiką i klimatem retro-modern.",
    sadoles_title: "Sadoleś 66",
    sadoles_tag: "Hygge w nadbużańskiej głuszy",
    sadoles_desc: "Ekologiczny, skandynawski dom w sercu Nadbużańskiego Parku Krajobrazowego. Autentyczny duński design, sauna i spokój natury.",
    form_name: "Imię i nazwisko",
    form_email: "Adres e-mail",
    form_phone: "Numer telefonu",
    form_guests: "Liczba osób",
    form_pets: "Zwierzęta",
    form_notes: "Uwagi do rezerwacji",
    form_purpose: "Cel wyjazdu",
    form_company_name: "Nazwa firmy",
    form_nip: "NIP",
    purposes: {
      leisure: "Wyjazd wypoczynkowy",
      production: "Sesja lub nagrania reklamowe",
      company: "Wyjazd firmowy"
    },
    continue: "Kontynuuj",
    submit: "Potwierdź rezerwację",
    success_title: "Dziękujemy za rezerwację!",
    success_msg: "Twoje zgłoszenie zostało przyjęte. Skontaktujemy się z Tobą wkrótce w celu potwierdzenia i przesłania danych do płatności.",
    capacity: "Liczba osób",
    location: "Lokalizacja",
    status: "Status",
    status_open: "Owarte na rezerwacje",
    tag_lake: "Jezioro",
    tag_nature: "Natura",
    hacjenda_capacity: "Do 7 osób",
    hacjenda_location: "Poznań, nad samym brzegiem jeziora",
    sadoles_capacity: "Do 15 osób",
    sadoles_location: "Sadoleś, w sercu lasu",
    bedrooms_title: "Sypialnie i łóżka",
    the_house: "Dom i otoczenie",
    reviews_title: "Opinie gości",
    rating_from: "ocena z",
    ratings_count: "opinii",
    total_score: "Wynik łączny",
    based_on: "na podstawie {count} prawdziwych opinii",
    social_media: "Znajdź nas na",
    view_gallery: "Zobacz galerię zdjęć",
    all_photos: "Wszystkie zdjęcia",
    filter_by_area: "Filtruj według obszaru",
    booking_steps: "W tej chwili nic nie płacisz. Aby potwierdzić rezerwację, wpłać zaliczkę w wysokości {deposit} PLN w ciągu 24h. Pozostałą kwotę oraz kaucję zwrotną należy uregulować na kilka dni przed przyjazdem. W przypadku anulowania rezerwacji na co najmniej 28 dni przed przyjazdem, zaliczka jest zwracana. Wszystkie szczegóły otrzymasz w wiadomości e-mail.",
    areas: {
      salon: "Salon",
      jadalnia: "Jadalnia",
      kuchnia: "Kuchnia",
      "sypialnia 1": "Sypialnia 1",
      "sypialnia 2": "Sypialnia 2",
      "sypialnia master": "Sypialnia Master",
      "sypialnia złota": "Sypialnia Złota",
      "sypialnia niebieska": "Sypialnia Niebieska",
      "sypialnia brązowa": "Sypialnia Brązowa",
      "sypialnia czarna": "Sypialnia Black",
      "łazienka dół": "Łazienka dół",
      "łazienka dolna": "Łazienka dolna",
      "łazienka górna": "Łazienka górna",
      taras: "Taras",
      toaleta: "Toaleta",
      otoczenie: "Otoczenie",
      wejście: "Wejście"
    }
  },
  EN: {
    document_title: "Book your stay",
    header_title: "Our-bnb",
    footer_desc: "Two unique properties designed for slow living and connection with nature.",
    about_us: "About Us",
    contact: "Contact",
    hero_title: "Book Your Stay",
    hero_subtitle: "Two unique places, two different characters. Choose your escape.",
    book_now: "Book Now",
    back: "Back",
    availability: "Availability",
    total_price: "Total Price",
    nights: "nights",
    per_night: "per night",
    hacjenda_title: "Hacjenda Kiekrz",
    hacjenda_tag: "Modernist lakeside villa",
    hacjenda_desc: "A unique, modernist villa from the 1970s located directly on the shores of Lake Kierskie. A house with soul, Andalusian ceramics, and a retro-modern vibe.",
    sadoles_title: "Sadoleś 66",
    sadoles_tag: "Hygge in the Masovian countryside",
    sadoles_desc: "An eco-friendly, Scandinavian house in the heart of the Bug Landscape Park. Authentic Danish design, sauna, and the peace of nature.",
    form_name: "Full Name",
    form_email: "Email Address",
    form_phone: "Phone Number",
    form_guests: "Number of Guests",
    form_pets: "Pets",
    form_notes: "Reservation Notes",
    form_purpose: "Purpose of Stay",
    form_company_name: "Company Name",
    form_nip: "NIP",
    purposes: {
      leisure: "Leisure",
      production: "Photo session / Product recording",
      company: "Company trip"
    },
    continue: "Continue",
    submit: "Confirm Reservation",
    success_title: "Thank you for booking!",
    success_msg: "Your reservation has been received. We will contact you soon to confirm and send payment details.",
    capacity: "Capacity",
    location: "Location",
    status: "Status",
    status_open: "Open for bookings",
    tag_lake: "Lake",
    tag_nature: "Nature",
    hacjenda_capacity: "Up to 7 guests",
    hacjenda_location: "Poznań, Lake shore",
    sadoles_capacity: "Up to 15 guests",
    sadoles_location: "Sadoleś, Forest",
    bedrooms_title: "Bedrooms & Beds",
    the_house: "The House",
    reviews_title: "Guest Reviews",
    rating_from: "rating from",
    ratings_count: "reviews",
    total_score: "Total Score",
    based_on: "based on {count} real reviews",
    social_media: "Follow us",
    view_gallery: "View photo gallery",
    all_photos: "All photos",
    filter_by_area: "Filter by area",
    booking_steps: "You are not paying anything yet. To confirm your reservation, pay a fee of {deposit} PLN within 24h. The remaining balance and the refundable security deposit should be paid a few days before arrival. If the booking is cancelled at least 28 days before arrival, the reservation fee is returned. You will receive all details in an email.",
    areas: {
      salon: "Living Room",
      jadalnia: "Dining Room",
      kuchnia: "Kitchen",
      "sypialnia 1": "Bedroom 1",
      "sypialnia 2": "Bedroom 2",
      "sypialnia master": "Master Bedroom",
      "sypialnia złota": "Golden Bedroom",
      "sypialnia niebieska": "Blue Bedroom",
      "sypialnia brązowa": "Brown Bedroom",
      "sypialnia czarna": "Black Bedroom",
      "łazienka dół": "Downstairs Bathroom",
      "łazienka dolna": "Lower Bathroom",
      "łazienka górna": "Upper Bathroom",
      taras: "Terrace",
      toaleta: "Toilet",
      otoczenie: "Surroundings",
      wejście: "Entrance"
    }
  }
};

// ─── Gallery Component ────────────────────────────────────────────────────────

function ImageGallery({ 
  images, 
  lang, 
  onClose, 
  initialFilter 
}: { 
  images: string[], 
  lang: Lang, 
  onClose: () => void,
  initialFilter?: string
}) {
  const [filter, setFilter] = useState<string | null>(initialFilter || null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  const filteredImages = useMemo(() => {
    if (!filter) return images;
    return images.filter(img => img.includes(`/${filter}/`));
  }, [images, filter]);

  const areas = useMemo(() => {
    const set = new Set<string>();
    images.forEach(img => {
      const parts = img.split("/");
      // Only include if it's in a subfolder (e.g., /images/Hacjenda/salon/img.jpg)
      // Parts: ["", "images", "Property", "Area", "file.jpg"] -> length 5
      if (parts.length > 4) set.add(parts[3]);
    });
    return Array.from(set).sort();
  }, [images]);

  useEffect(() => {
    setIsZoomed(false);
  }, [selectedIdx]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedIdx === null) return;
      if (e.key === "Escape") setSelectedIdx(null);
      if (e.key === "ArrowLeft" && selectedIdx > 0) setSelectedIdx(selectedIdx - 1);
      if (e.key === "ArrowRight" && selectedIdx < filteredImages.length - 1) setSelectedIdx(selectedIdx + 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIdx, filteredImages]);

  const texts = T[lang];

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col overflow-hidden">
      <div className="h-16 border-b flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onClose}><X /></Button>
          <h2 className="font-black text-xl">{texts.view_gallery}</h2>
        </div>
        <div className="flex items-center gap-2">
           <Filter className="h-4 w-4 text-zinc-400" />
           <select 
             className="bg-zinc-50 border-0 rounded-lg px-3 py-1.5 text-sm font-bold focus:ring-2 focus:ring-primary"
             value={filter || ""}
             onChange={e => setFilter(e.target.value || null)}
           >
             <option value="">{texts.all_photos}</option>
             {areas.map(area => (
               <option key={area} value={area}>{(texts.areas as any)[area] || area}</option>
             ))}
           </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredImages.map((img, idx) => (
            <div 
              key={img} 
              className="aspect-square bg-zinc-100 rounded-xl overflow-hidden cursor-pointer group relative"
              onClick={() => setSelectedIdx(idx)}
            >
              <img src={getThumbnailUrl(img, 600)} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <Maximize2 className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedIdx !== null && (
        <div className="fixed inset-0 z-[110] bg-black flex flex-col">
          <div className="absolute top-4 right-4 z-[120] flex gap-2">
             <Button 
               variant="outline" 
               className="bg-black/50 text-white border-white/20 hover:bg-black/80" 
               size="icon" 
               onClick={() => setIsZoomed(!isZoomed)}
             >
               {isZoomed ? <ZoomOut /> : <ZoomIn />}
             </Button>
             <Button variant="outline" className="bg-black/50 text-white border-white/20 hover:bg-black/80" size="icon" onClick={() => setSelectedIdx(null)}><X /></Button>
          </div>
          <div className="flex-1 overflow-auto flex p-4 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
             <img 
               src={filteredImages[selectedIdx]} 
               alt="" 
               className={cn(
                 "m-auto shadow-2xl transition-all duration-300",
                 isZoomed ? "max-w-none cursor-zoom-out" : "max-w-full max-h-full object-contain cursor-zoom-in"
               )} 
               onClick={() => setIsZoomed(!isZoomed)}
             />
          </div>
          <div className="h-24 bg-black/80 flex items-center justify-between px-8 text-white shrink-0">
             <Button 
               variant="ghost" 
               className="text-white hover:bg-white/10"
               disabled={selectedIdx === 0}
               onClick={() => setSelectedIdx(selectedIdx - 1)}
             >
               <ChevronLeft className="mr-2" /> Previous
             </Button>
             <span className="font-bold text-sm tracking-widest">{selectedIdx + 1} / {filteredImages.length}</span>
             <Button 
               variant="ghost" 
               className="text-white hover:bg-white/10"
               disabled={selectedIdx === filteredImages.length - 1}
               onClick={() => setSelectedIdx(selectedIdx + 1)}
             >
               Next <ChevronRight className="ml-2" />
             </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────

function Layout({ children, lang, setLang }: { children: React.ReactNode, lang: Lang, setLang: (l: Lang) => void }) {
  const [menuOpen, setMenu] = useState(false);
  const [location, setLocation] = useLocation();
  const texts = T[lang];

  const bgImages = useMemo(() => {
    if (location === "/hacjenda") return ["/images/Hacjenda/main.jpg"];
    if (location === "/sadoles") return ["/images/Sadoles/otoczenie/MAIN.jpg"];
    return ["/images/Hacjenda/main.jpg", "/images/Sadoles/otoczenie/MAIN.jpg"];
  }, [location]);

  return (
    <div className="h-screen flex flex-col font-sans overflow-hidden relative">
      {/* Background Images */}
      <div className="absolute inset-0 z-0 flex flex-col overflow-hidden">
        {bgImages.map((img, idx) => (
          <div 
            key={img}
            className="flex-1 bg-cover bg-center bg-no-repeat transition-all duration-1000"
            style={{ backgroundImage: `url('${getThumbnailUrl(img, 1920)}')` }}
          />
        ))}
      </div>
      {/* Overlay to ensure readability */}
      <div className="absolute inset-0 z-10 bg-black/30" />

      <nav className="relative z-50 bg-white/20 backdrop-blur-md border-b border-white/20">
        <div className="max-w-6xl mx-auto px-4 h-12 md:h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setLocation("/")}>
            <HomeIcon className="h-4 w-4 md:h-5 md:w-5 text-white" />
            <span className="font-bold tracking-tight text-base md:text-lg text-white">{texts.header_title}</span>
          </div>

          <div className="hidden md:flex items-center gap-8">
            <button onClick={() => setLocation("/hacjenda")} className="text-sm font-medium text-white hover:text-white/80 transition-colors">Hacjenda</button>
            <button onClick={() => setLocation("/sadoles")} className="text-sm font-medium text-white hover:text-white/80 transition-colors">Sadoleś</button>
            <button onClick={() => setLocation("/about")} className="text-sm font-medium text-white hover:text-white/80 transition-colors">{texts.about_us}</button>
            <div className="h-4 w-[1px] bg-white/20" />
            <button
              onClick={() => setLang(lang === "PL" ? "EN" : "PL")}
              className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/70 hover:text-white"
            >
              <Languages className="h-3.5 w-3.5" />
              {lang}
            </button>
          </div>

          <button className="md:hidden text-white" onClick={() => setMenu(!menuOpen)}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      <main className="flex-1 relative z-[60] overflow-y-auto px-2 py-2 md:px-8 md:py-6 flex flex-col no-scrollbar">
        <div className="max-w-7xl mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────

function AboutUs({ lang }: { lang: Lang }) {
  const texts = T[lang];
  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="bg-white/70 backdrop-blur-md rounded-3xl shadow-2xl p-4 md:p-6 max-w-4xl w-full max-h-[50%] overflow-y-auto space-y-4 md:space-y-6 no-scrollbar">
        <div className="text-center py-2">
          <h1 className="text-2xl md:text-4xl font-black mb-2 leading-tight text-zinc-900">{texts.about_us}</h1>
          <p className="text-sm md:text-base text-zinc-600 max-w-2xl mx-auto">{texts.footer_desc}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 pb-2">
          <section className="space-y-2">
            <h3 className="text-lg font-black flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              {texts.contact}
            </h3>
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-zinc-400" />
                  <a href={`mailto:${import.meta.env.VITE_GMAIL_USER || 'furtka.rentals@gmail.com'}`} className="hover:text-primary transition-colors">{import.meta.env.VITE_GMAIL_USER || 'furtka.rentals@gmail.com'}</a>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 text-zinc-400" />
                  <span>{import.meta.env.VITE_CONTACT_PHONE || '+48571525563'}</span>
                </div>
              </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-lg font-black flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" />
              Social Media
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[7px] font-bold uppercase text-zinc-400">Hacjenda Kiekrz</span>
                <div className="flex gap-2">
                  <a href={PROPERTIES_DATA.Hacjenda.social.fb} target="_blank" rel="noreferrer" className="bg-white/80 p-1.5 rounded-full hover:bg-white transition-all shadow-sm">
                    <Share2 className="h-3.5 w-3.5" />
                  </a>
                  <a href={PROPERTIES_DATA.Hacjenda.social.ig} target="_blank" rel="noreferrer" className="bg-white/80 p-1.5 rounded-full hover:bg-white transition-all shadow-sm">
                    <Camera className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[7px] font-bold uppercase text-zinc-400">Sadoleś 66</span>
                <div className="flex gap-2">
                  <a href={PROPERTIES_DATA.Sadoles.social.fb} target="_blank" rel="noreferrer" className="bg-white/80 p-1.5 rounded-full hover:bg-white transition-all shadow-sm">
                    <Share2 className="h-3.5 w-3.5" />
                  </a>
                  <a href={PROPERTIES_DATA.Sadoles.social.ig} target="_blank" rel="noreferrer" className="bg-white/80 p-1.5 rounded-full hover:bg-white transition-all shadow-sm">
                    <Camera className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Home({ lang }: { lang: Lang }) {
  const [, setLocation] = useLocation();
  const texts = T[lang];

  return (
    <div className="bg-white/70 backdrop-blur-md rounded-3xl shadow-2xl p-4 md:p-10 min-h-full space-y-8 md:space-y-12">
      <div className="text-center py-4 md:py-8">
        <h1 className="text-3xl md:text-6xl font-black mb-4 md:mb-6 leading-tight text-zinc-900">{texts.hero_title}</h1>
        <p className="text-base md:text-xl text-zinc-600 max-w-2xl mx-auto">{texts.hero_subtitle}</p>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 pb-12">
        {/* Hacjenda Card */}
        <div 
          onClick={() => setLocation("/hacjenda")}
          className="group cursor-pointer bg-white/50 backdrop-blur-sm rounded-3xl border border-white/50 shadow-xl overflow-hidden transition-all hover:-translate-y-2 hover:bg-white/70"
        >
          <div className="h-48 md:h-64 bg-zinc-200 relative overflow-hidden">
            <div 
              className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110" 
              style={{ backgroundImage: `url('${getThumbnailUrl('/images/Hacjenda/main.jpg', 800)}')` }}
            />
            <div className="absolute top-4 left-4 bg-hacjenda-secondary text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 shadow-lg">
              <Waves className="h-3 w-3" /> {texts.tag_lake}
            </div>
          </div>
          <div className="p-6 md:p-8">
            <h3 className="text-xl md:text-2xl font-bold mb-2 group-hover:text-hacjenda-primary transition-colors">{texts.hacjenda_title}</h3>
            <p className="text-xs md:text-sm font-medium text-zinc-500 mb-4 uppercase tracking-wider">{texts.hacjenda_tag}</p>
            <p className="text-zinc-600 text-sm md:text-base leading-relaxed line-clamp-3">{texts.hacjenda_desc}</p>
            <div className="mt-4 md:mt-6 flex items-center text-hacjenda-primary font-bold gap-2 text-sm md:text-base">
              {texts.book_now} <ChevronRight className="h-4 w-4" />
            </div>
          </div>
        </div>

        {/* Sadoleś Card */}
        <div 
          onClick={() => setLocation("/sadoles")}
          className="group cursor-pointer bg-white/50 backdrop-blur-sm rounded-3xl border border-white/50 shadow-xl overflow-hidden transition-all hover:-translate-y-2 hover:bg-white/70"
        >
          <div className="h-48 md:h-64 bg-zinc-200 relative overflow-hidden">
            <div 
              className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110" 
              style={{ backgroundImage: `url('${getThumbnailUrl('/images/Sadoles/otoczenie/MAIN.jpg', 800)}')` }}
            />
            <div className="absolute top-4 left-4 bg-sadoles-primary text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 shadow-lg">
              <Trees className="h-3 w-3" /> {texts.tag_nature}
            </div>
          </div>
          <div className="p-6 md:p-8">
            <h3 className="text-xl md:text-2xl font-bold mb-2 group-hover:text-sadoles-primary transition-colors">{texts.sadoles_title}</h3>
            <p className="text-xs md:text-sm font-medium text-zinc-500 mb-4 uppercase tracking-wider">{texts.sadoles_tag}</p>
            <p className="text-zinc-600 text-sm md:text-base leading-relaxed line-clamp-3">{texts.sadoles_desc}</p>
            <div className="mt-4 md:mt-6 flex items-center text-sadoles-primary font-bold gap-2 text-sm md:text-base">
              {texts.book_now} <ChevronRight className="h-4 w-4" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>("PL");
  const [location] = useLocation();
  const logVisit = trpc.portal.logVisit.useMutation();

  useEffect(() => {
    document.title = T[lang].document_title;
  }, [lang]);

  useEffect(() => {
    let page = "other";
    if (location === "/") page = "main";
    else if (location === "/hacjenda") page = "Hacjenda";
    else if (location === "/sadoles") page = "Sadoles";
    
    if (page !== "other") {
      logVisit.mutate({ page });
    }
  }, [location]);

  return (
    <Layout lang={lang} setLang={setLang}>
      <Toaster />
      <Switch>
        <Route path="/">
          <Home lang={lang} />
        </Route>
        <Route path="/hacjenda">
          <PropertyPage key="Hacjenda" property="Hacjenda" lang={lang} />
        </Route>
        <Route path="/sadoles">
          <PropertyPage key="Sadoles" property="Sadoles" lang={lang} />
        </Route>
        <Route path="/about">
          <AboutUs lang={lang} />
        </Route>
        <Route path="/success">
          <SuccessPage lang={lang} />
        </Route>
      </Switch>
    </Layout>
  );
}

// ─── Booking Logic Component ──────────────────────────────────────────────────

function PropertyPage({ property, lang }: { property: "Hacjenda" | "Sadoles", lang: Lang }) {
  const [, setLocation] = useLocation();
  const texts = T[lang];
  const locale = lang === "PL" ? pl : enGB;
  const isHacjenda = property === "Hacjenda";
  const maxGuests = PROPERTIES_DATA[property].maxGuests;
  
  const [checkIn, setCheckIn] = useState<Date | undefined>();
  const [checkOut, setCheckOut] = useState<Date | undefined>();
  const [guestCount, setGuests] = useState(isHacjenda ? 5 : 10);
  const [petCount, setPets] = useState(0);
  
  useEffect(() => {
    setGuests(isHacjenda ? 5 : 10);
  }, [isHacjenda]);

  const [bookingStep, setStep] = useState(1);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [activePicker, setActivePicker] = useState<"in" | "out" | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

  // Use the full date object with time for the server query
  const normalizedCheckIn = useMemo(() => checkIn || null, [checkIn]);
  const normalizedCheckOut = useMemo(() => checkOut || null, [checkOut]);

  const { data: pricingRules } = trpc.portal.getPricingPlanForDate.useQuery(
    { property, date: normalizedCheckIn! },
    { enabled: !!normalizedCheckIn }
  );

  const { data: priceData, error: priceError } = trpc.portal.calculatePrice.useQuery(
    { property, checkIn: normalizedCheckIn!, checkOut: normalizedCheckOut!, guestCount, animalsCount: petCount },
    { enabled: !!normalizedCheckIn && !!normalizedCheckOut }
  );

  const [guestName, setName] = useState("");
  const [guestEmail, setEmail] = useState("");
  const [guestPhone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [purpose, setPurpose] = useState("leisure");
  const [companyName, setCompanyName] = useState("");
  const [nip, setNip] = useState("");

  const [galleryOpen, setGallery] = useState(false);
  const [initialFilter, setInitialFilter] = useState<string | undefined>();
  const [expandedMap, setExpandedMap] = useState(false);

  const { data: blockedRanges = [] } = trpc.portal.getAvailability.useQuery({ property });
  const isBlocked = (date: Date, isCheckout = false) => {
    return blockedRanges.some(range => {
      const start = new Date(range.checkIn);
      const end = new Date(range.checkOut);
      const d = startOfDay(date);
      const s = startOfDay(start);
      const e = startOfDay(end);

      // If we are checking for a check-out date
      if (isCheckout) {
        // A date is blocked for checkout only if it falls WITHIN a booking,
        // but NOT if it's the start date of a booking (unless check-out is late).
        // Standard check-out is 10AM, standard check-in is 4PM.
        // If current date 'd' is the same as booking start 's':
        if (d.getTime() === s.getTime()) {
          // If we have a specific checkout time set, check if it's at least 6h before check-in.
          // Since we don't always have the full Date with time here (calendar uses startOfDay),
          // we assume standard times for the calendar view but the final validation happens on server.
          // However, for the 'disabled' prop in Calendar, we usually just want to know if the DAY is available.
          return false; // Allow selecting start day of another booking as checkout day
        }
        return d >= s && d < e;
      }

      // If we are checking for a check-in date
      if (d.getTime() === e.getTime()) {
        return false; // Allow selecting end day of another booking as check-in day
      }

      return d >= s && d < e;
    });
  };

  const { data: ratings = [] } = trpc.portal.getRatings.useQuery({ property });

  const submitBooking = trpc.portal.submitBooking.useMutation({
    onSuccess: () => setLocation("/success"),
    onError: (err) => toast.error(err.message),
  });

  const handleBooking = () => {
    if (!checkIn || !checkOut) return;
    submitBooking.mutate({ 
      property, 
      checkIn: normalizedCheckIn!, 
      checkOut: normalizedCheckOut!, 
      guestName, 
      guestEmail, 
      guestPhone, 
      guestCount, 
      animalsCount: petCount, 
      notes, 
      guestCountry: lang,
      purpose,
      companyName,
      nip
    });
  };

  const getDisabledHours = (date: Date | undefined, type: "in" | "out") => {
    if (!date) return [];
    const d = startOfDay(date);
    const disabled: number[] = [];

    blockedRanges.forEach(range => {
      const start = new Date(range.checkIn);
      const end = new Date(range.checkOut);
      const s = startOfDay(start);
      const e = startOfDay(end);

      if (type === "out") {
        if (d.getTime() === s.getTime()) {
          const latestAllowed = start.getHours() - 6;
          for (let h = 0; h < 24; h++) {
            if (h > latestAllowed) disabled.push(h);
          }
        }
      } else {
        if (d.getTime() === e.getTime()) {
          const earliestAllowed = end.getHours() + 6;
          for (let h = 0; h < 24; h++) {
            if (h < earliestAllowed) disabled.push(h);
          }
        }
      }
    });
    return disabled;
  };

  const primaryColor = isHacjenda ? "bg-hacjenda-primary" : "bg-sadoles-primary";
  const textColor = isHacjenda ? "text-hacjenda-primary" : "text-sadoles-primary";
  
  const allThumbnails = useMemo(() => {
    return [...PROPERTIES_DATA[property].bedrooms, ...PROPERTIES_DATA[property].otherAreas];
  }, [property]);

  return (
    <div className="min-h-full flex flex-col gap-4 md:gap-8 pb-8 md:pb-0">
      {galleryOpen && (
        <ImageGallery 
          images={PROPERTIES_DATA[property].allImages} 
          lang={lang} 
          onClose={() => setGallery(false)} 
          initialFilter={initialFilter}
        />
      )}

      {expandedMap && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col p-4 md:p-12">
           <div className="flex justify-between items-center mb-4 text-white">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                <span className="font-bold">{PROPERTIES_DATA[property].address}</span>
              </div>
              <Button variant="ghost" className="text-white hover:bg-white/10" onClick={() => setExpandedMap(false)}><X /></Button>
           </div>
           <div className="flex-1 rounded-3xl overflow-hidden shadow-2xl bg-zinc-800">
             <iframe src={PROPERTIES_DATA[property].mapEmbed} className="w-full h-full border-0" allowFullScreen loading="lazy" />
           </div>
        </div>
      )}

      {/* TOP SECTION */}
      <header className="shrink-0 flex flex-col md:flex-row gap-3 md:gap-6 items-start justify-between bg-white/40 backdrop-blur-md p-4 md:p-6 rounded-3xl border border-white/40 shadow-sm">
        <div className="flex-1 space-y-1 md:space-y-2">
          <div className="flex items-center gap-3 md:gap-4">
            <button onClick={() => setLocation("/")} className="text-zinc-500 hover:text-zinc-900 transition-colors"><ArrowLeft className="h-4 w-4 md:h-5 md:w-5" /></button>
            <h1 className="text-lg md:text-2xl font-black text-zinc-900">{isHacjenda ? texts.hacjenda_title : texts.sadoles_title}</h1>
          </div>
          <p className="text-[10px] md:text-sm leading-relaxed text-zinc-800 max-w-2xl font-medium line-clamp-2 md:line-clamp-none">
            {isHacjenda ? texts.hacjenda_desc : texts.sadoles_desc}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 md:gap-3 items-center">
          <div className="flex bg-white/60 rounded-xl md:rounded-2xl p-1.5 md:p-2 px-3 md:px-4 items-center gap-2 md:gap-3 border border-white/60 shadow-sm">
            <div className="flex items-center gap-1 md:gap-1.5">
              <Users className={`h-3 w-3 md:h-4 md:w-4 ${textColor}`} />
              <span className="text-[8px] md:text-[10px] font-black uppercase tracking-tight text-zinc-500">{isHacjenda ? texts.hacjenda_capacity : texts.sadoles_capacity}</span>
            </div>
            <div className="w-[1px] h-3 md:h-4 bg-zinc-200" />
            <div className="flex items-center gap-1 md:gap-1.5 cursor-pointer hover:opacity-70 transition-opacity" onClick={() => setExpandedMap(true)}>
              <MapPin className={`h-3 w-3 md:h-4 md:w-4 ${textColor}`} />
              <span className="text-[8px] md:text-[10px] font-black uppercase tracking-tight text-zinc-500">{texts.location}</span>
            </div>
            <div className="w-[1px] h-3 md:h-4 bg-zinc-200" />
            <div className="flex items-center gap-2 md:gap-3">
               <a href={PROPERTIES_DATA[property].social.fb} target="_blank" rel="noreferrer" className="hover:text-zinc-900 transition-colors"><Share2 className="h-3 w-3 md:h-4 md:w-4" /></a>
               <a href={PROPERTIES_DATA[property].social.ig} target="_blank" rel="noreferrer" className="hover:text-zinc-900 transition-colors"><Camera className="h-3 w-3 md:h-4 md:w-4" /></a>
            </div>
          </div>
          
          <Button 
            onClick={() => { setInitialFilter(undefined); setGallery(true); }}
            className="bg-zinc-900 text-white rounded-xl md:rounded-2xl font-bold px-3 md:px-5 h-9 md:h-12 shadow-lg hover:scale-105 transition-all text-[10px] md:text-xs"
          >
            <ImageIcon className="mr-1.5 md:mr-2 h-3 w-3 md:h-4 md:w-4" /> {texts.view_gallery}
          </Button>
        </div>
      </header>

      {/* MIDDLE SECTION */}
      <div className="flex flex-col md:flex-row items-center md:justify-between gap-8 md:gap-0 px-2 md:px-0 w-full py-4 md:py-0">
        <div className="w-full max-w-sm md:max-w-md bg-white/80 backdrop-blur-xl rounded-[1.5rem] md:rounded-[2rem] shadow-2xl border border-white/50 overflow-hidden">
          <div className={`${primaryColor} py-1.5 md:py-2 px-4 text-white text-center`}>
            <div className="text-[10px] md:text-xs font-black uppercase tracking-[0.2em]">{texts.book_now}</div>
          </div>
          
          <div className="p-3 md:p-5 space-y-2 md:space-y-3">
            {bookingStep === 1 ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <label className="text-[10px] md:text-xs font-black uppercase text-zinc-500 tracking-wider ml-1">{texts.form_guests}</label>
                    <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-white/50 rounded-lg shadow-sm border border-zinc-100">
                      <button onClick={() => setGuests(Math.max(1, guestCount-1))} className="h-5 w-5 rounded bg-white shadow-sm font-black text-[10px]">-</button>
                      <span className="font-black text-[10px] w-3 text-center">{guestCount}</span>
                      <button onClick={() => setGuests(Math.min(maxGuests, guestCount+1))} className="h-5 w-5 rounded bg-white shadow-sm font-black text-[10px]">+</button>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <label className="text-[10px] md:text-xs font-black uppercase text-zinc-500 tracking-wider ml-1">{texts.form_pets}</label>
                    <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-white/50 rounded-lg shadow-sm border border-zinc-100">
                      <button onClick={() => setPets(Math.max(0, petCount-1))} className="h-5 w-5 rounded bg-white shadow-sm font-black text-[10px]">-</button>
                      <span className="font-black text-[10px] w-3 text-center">{petCount}</span>
                      <button onClick={() => setPets(Math.min(3, petCount+1))} className="h-5 w-5 rounded bg-white shadow-sm font-black text-[10px]">+</button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-0.5">
                    <label className="text-[10px] md:text-xs font-black uppercase text-zinc-500 tracking-wider ml-1">{lang === "PL" ? "Przyjazd" : "Check-in"}</label>
                    <Popover open={calendarOpen && activePicker === "in"} onOpenChange={(o) => { if (o) setActivePicker("in"); setCalendarOpen(o); }}>
                      <PopoverTrigger asChild>
                        <Button 
                          variant="outline" 
                          className={cn("w-full justify-start text-left font-black bg-white/50 border-0 rounded-lg h-8 md:h-10 shadow-sm hover:bg-white transition-all text-[10px] md:text-xs", !checkIn && "text-zinc-400")}
                        >
                          <CalendarCheck2 className="mr-1 h-3 w-3 text-primary" />
                          {checkIn ? format(checkIn, "dd.MM.yy HH:mm", { locale }) : "---"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <div className="p-3 border-b border-zinc-100 flex items-center justify-between gap-4">
                          <span className="text-[10px] font-black uppercase text-zinc-500">{lang === "PL" ? "Godzina" : "Time"}</span>
                          <div className="flex items-center gap-1">
                             <Select 
                               value={checkIn ? format(checkIn, "HH") : "16"} 
                               onValueChange={(h) => {
                                 if (checkIn) setCheckIn(setHours(checkIn, parseInt(h)));
                               }}
                             >
                               <SelectTrigger className="h-7 w-20 px-2 text-xs font-bold">
                                 <SelectValue />
                               </SelectTrigger>
                               <SelectContent>
                                 {Array.from({ length: 24 }).map((_, i) => {
                                   const isDisabled = getDisabledHours(checkIn, "in").includes(i);
                                   return (
                                     <SelectItem key={i} value={i.toString().padStart(2, "0")} disabled={isDisabled}>
                                       {i.toString().padStart(2, "0")}
                                     </SelectItem>
                                   );
                                 })}
                               </SelectContent>
                             </Select>
                             <span className="font-bold">:</span>
                             <Select 
                               value={checkIn ? format(checkIn, "mm") : "00"} 
                               onValueChange={(m) => {
                                 if (checkIn) setCheckIn(setMinutes(checkIn, parseInt(m)));
                               }}
                             >
                               <SelectTrigger className="h-7 w-20 px-2 text-xs font-bold">
                                 <SelectValue />
                               </SelectTrigger>
                               <SelectContent>
                                 {["00", "15", "30", "45"].map((m) => (
                                   <SelectItem key={m} value={m}>{m}</SelectItem>
                                 ))}
                               </SelectContent>
                             </Select>
                          </div>
                        </div>
                        <Calendar
                          mode="single"
                          locale={locale}
                          selected={checkIn}
                          month={calendarMonth}
                          onMonthChange={setCalendarMonth}                          onSelect={(d) => {
                            if (d) {
                              const withTime = setMinutes(setHours(d, 16), 0);
                              setCheckIn(withTime);
                            } else {
                              setCheckIn(undefined);
                            }

                            // Check if existing check-out is still valid with new check-in
                            let shouldClearCheckOut = false;
                            if (d && checkOut) {
                              const minStay = pricingRules?.minStay || 1;
                              const diff = differenceInDays(startOfDay(checkOut), startOfDay(d));
                              if (diff < minStay || startOfDay(checkOut) <= startOfDay(d)) {
                                shouldClearCheckOut = true;
                              }
                            }

                            if (d && (!checkOut || shouldClearCheckOut)) { 
                              if (shouldClearCheckOut) setCheckOut(undefined);
                              
                              // Use a small delay to let the check-in popover close 
                              // and allow the check-out one to open without state conflicts
                              setCalendarOpen(false);
                              setTimeout(() => {
                                setActivePicker("out"); 
                                setCalendarOpen(true); 
                                if (d) setCalendarMonth(d);
                              }, 50);
                            } else {
                              setCalendarOpen(false);
                            }
                          }} 
                          disabled={(date) => date < startOfDay(new Date()) || isBlocked(date, false)} 
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-0.5">
                    <label className="text-[10px] md:text-xs font-black uppercase text-zinc-500 tracking-wider ml-1">{lang === "PL" ? "Wyjazd" : "Check-out"}</label>
                    <Popover open={calendarOpen && activePicker === "out"} onOpenChange={(o) => { if (o) setActivePicker("out"); setCalendarOpen(o); }}>
                      <PopoverTrigger asChild>
                        <Button 
                          variant="outline" 
                          className={cn("w-full justify-start text-left font-black bg-white/50 border-0 rounded-lg h-8 md:h-10 shadow-sm hover:bg-white transition-all text-[10px] md:text-xs", !checkOut && "text-zinc-400")}
                        >
                          <CalendarX2 className="mr-1 h-3 w-3 text-primary" />
                          {checkOut ? format(checkOut, "dd.MM.yy HH:mm", { locale }) : "---"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="end">
                        <div className="p-3 border-b border-zinc-100 flex items-center justify-between gap-4">
                          <span className="text-[10px] font-black uppercase text-zinc-500">{lang === "PL" ? "Godzina" : "Time"}</span>
                          <div className="flex items-center gap-1">
                             <Select 
                               value={checkOut ? format(checkOut, "HH") : "10"} 
                               onValueChange={(h) => {
                                 if (checkOut) setCheckOut(setHours(checkOut, parseInt(h)));
                               }}
                             >
                               <SelectTrigger className="h-7 w-20 px-2 text-xs font-bold">
                                 <SelectValue />
                               </SelectTrigger>
                               <SelectContent>
                                 {Array.from({ length: 24 }).map((_, i) => {
                                   const isDisabled = getDisabledHours(checkOut, "out").includes(i);
                                   return (
                                     <SelectItem key={i} value={i.toString().padStart(2, "0")} disabled={isDisabled}>
                                       {i.toString().padStart(2, "0")}
                                     </SelectItem>
                                   );
                                 })}
                               </SelectContent>
                             </Select>
                             <span className="font-bold">:</span>
                             <Select 
                               value={checkOut ? format(checkOut, "mm") : "00"} 
                               onValueChange={(m) => {
                                 if (checkOut) setCheckOut(setMinutes(checkOut, parseInt(m)));
                               }}
                             >
                               <SelectTrigger className="h-7 w-20 px-2 text-xs font-bold">
                                 <SelectValue />
                               </SelectTrigger>
                               <SelectContent>
                                 {["00", "15", "30", "45"].map((m) => (
                                   <SelectItem key={m} value={m}>{m}</SelectItem>
                                 ))}
                               </SelectContent>
                             </Select>
                          </div>
                        </div>
                        <Calendar
                          mode="single"
                          locale={locale}
                          selected={checkOut}
                          month={calendarMonth}
                          onMonthChange={setCalendarMonth}                          onSelect={(d) => {
                            if (d) {
                              const withTime = setMinutes(setHours(d, 10), 0);
                              setCheckOut(withTime);
                              setCalendarOpen(false);
                            } else {
                              setCheckOut(undefined);
                            }
                          }} 
                          modifiers={{ checkIn: checkIn ? [checkIn] : [] }}
                          modifiersClassNames={{ checkIn: "bg-primary/20 text-primary font-bold" }}
                          disabled={(date) => {
                            if (!checkIn) return date < startOfDay(new Date()) || isBlocked(date, true);
                            const minStay = pricingRules?.minStay || 1;
                            const diff = differenceInDays(startOfDay(date), startOfDay(checkIn));
                            return diff < minStay || isBlocked(date, true);
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {priceError && (
                  <div className="bg-rose-500/10 rounded-xl md:rounded-[1.5rem] p-3 md:p-4 border border-rose-500/20 text-[10px] text-rose-900 font-bold">
                    {priceError.message}
                  </div>
                )}

                {priceData && priceData.valid && (
                  <div className="bg-emerald-500/10 rounded-xl md:rounded-[1.5rem] p-3 md:p-4 flex flex-col gap-1 border border-emerald-500/20">
                    <div className="flex justify-between items-center">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                           <div className="text-sm md:text-lg font-black text-emerald-900">{priceData.totalPrice} PLN</div>
                           {(priceData as any).discountAmount > 0 && (
                             <div className="text-[10px] md:text-xs font-bold text-zinc-400 line-through opacity-70">{(priceData as any).basePrice} PLN</div>
                           )}
                        </div>
                        {(priceData as any).discountAmount > 0 && (
                           <div className="text-[7px] md:text-[8px] font-black uppercase tracking-wider text-emerald-600">
                             {lang === "PL" ? "Zastosowano zniżki:" : "Discounts applied:"} 
                             {(priceData as any).appliedDiscounts?.duration > 0 && ` ${lang === "PL" ? "Dłuższy pobyt" : "Long stay"} (-${Math.round((priceData as any).appliedDiscounts.duration * 100)}%)`}
                             {(priceData as any).appliedDiscounts?.lastMinute && ` ${lang === "PL" ? "Last minute" : "Last minute"} (-5%)`}
                           </div>
                        )}
                      </div>
                      <CheckCircle2 className="text-emerald-500 h-4 w-4 md:h-5 md:w-5" />
                    </div>
                    <div className="text-[10px] md:text-xs font-bold text-emerald-700/70 flex justify-between items-center">
                      <span>{lang === "PL" ? "Cena za pobyt" : "Price for stay"} {format(checkIn!, "dd.MM HH:mm", { locale })} - {format(checkOut!, "dd.MM HH:mm", { locale })} ({priceData.days} {texts.nights})</span>
                      {petCount > 0 && (
                        <span className="text-[8px] md:text-[10px] uppercase tracking-wider opacity-60">
                          {lang === "PL" ? `w tym ${petCount * 200} zł za zwierzęta` : `incl. ${petCount * 200} zl for pets`}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {priceData && !priceData.valid && (
                  <div className="bg-rose-500/10 rounded-xl md:rounded-[1.5rem] p-3 md:p-4 flex justify-between items-center border border-rose-500/20">
                    <div className="text-xs md:text-sm font-bold text-rose-900 flex items-center gap-2">
                      <X className="h-4 w-4" />
                      {priceData.error}
                    </div>
                  </div>
                )}

                <Button disabled={!checkIn || !checkOut || (priceData && !priceData.valid)} onClick={() => setStep(2)} className={`w-full py-5 md:py-7 rounded-xl md:rounded-[1.5rem] font-black text-base md:text-lg shadow-xl ${primaryColor} hover:scale-105 transition-all`}>
                  {texts.continue}
                </Button>
              </>
            ) : (
              <div className="space-y-4 md:space-y-6">
                {/* Summary Row for Step 2 */}
                {priceData && (
                  <div className="bg-zinc-100 rounded-2xl p-4 space-y-3">
                     <div className="flex items-center justify-between">
                        <div>
                          <div className="text-[10px] font-black uppercase text-zinc-400 tracking-wider mb-1">{lang === "PL" ? "Twoja Rezerwacja" : "Your Reservation"}</div>
                          <div className="text-sm font-black text-zinc-900">{format(checkIn!, "dd.MM HH:mm", { locale })} - {format(checkOut!, "dd.MM HH:mm", { locale })}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-black uppercase text-zinc-400 tracking-wider mb-1">{lang === "PL" ? "Cena Całkowita" : "Total Price"}</div>
                          <div className="flex items-center gap-2 justify-end">
                            <div className="text-lg font-black text-zinc-900">{priceData.totalPrice} PLN</div>
                            {(priceData as any).discountAmount > 0 && (
                              <div className="text-[10px] font-bold text-zinc-400 line-through">{(priceData as any).basePrice} PLN</div>
                            )}
                          </div>
                          {(priceData as any).discountAmount > 0 && (
                            <div className="text-[8px] font-bold text-emerald-600 uppercase tracking-tighter">
                              {lang === "PL" ? "Zastosowano zniżki" : "Discounts applied"}
                            </div>
                          )}
                          {priceData.petFee > 0 && (
                            <div className="text-[8px] font-bold text-zinc-400 uppercase tracking-tighter mt-0.5">
                              {lang === "PL" ? `w tym ${priceData.petFee} zł za zwierzęta` : `incl. ${priceData.petFee} zl for pets`}
                            </div>
                          )}
                        </div>
                     </div>
                     <div className="flex gap-4 pt-2 border-t border-zinc-200">
                        <div className="flex items-center gap-1.5">
                           <Users className="h-3 w-3 text-zinc-400" />
                           <span className="text-[10px] font-bold text-zinc-600">{guestCount} {texts.form_guests}</span>
                        </div>
                        {petCount > 0 && (
                          <div className="flex items-center gap-1.5">
                             <Dog className="h-3 w-3 text-zinc-400" />
                             <span className="text-[10px] font-bold text-zinc-600">{petCount} {texts.form_pets}</span>
                          </div>
                        )}
                     </div>
                  </div>
                )}

                {priceData && (
                  <p className="text-[10px] md:text-xs text-zinc-500 font-medium leading-relaxed px-1">
                    {texts.booking_steps.replace("{deposit}", String(Math.round((priceData.totalPrice * 0.3) / 100) * 100))}
                  </p>
                )}

                <div className="grid gap-2 md:gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase text-zinc-400 tracking-wider ml-1">{texts.form_purpose}</label>
                    <Select value={purpose} onValueChange={setPurpose}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="leisure">{texts.purposes.leisure}</SelectItem>
                        <SelectItem value="production">{texts.purposes.production}</SelectItem>
                        <SelectItem value="company">{texts.purposes.company}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {purpose === "leisure" ? (
                    <input className="w-full bg-white/50 border-0 rounded-xl md:rounded-2xl px-4 md:px-5 py-2.5 md:py-3 text-xs md:text-sm font-bold shadow-sm" placeholder={texts.form_name} value={guestName} onChange={e => setName(e.target.value)} />
                  ) : (
                    <div className="grid grid-cols-2 gap-2 md:gap-3">
                      <input className="w-full bg-white/50 border-0 rounded-xl md:rounded-2xl px-4 md:px-5 py-2.5 md:py-3 text-[10px] md:text-sm font-bold shadow-sm" placeholder={texts.form_company_name} value={companyName} onChange={e => setCompanyName(e.target.value)} />
                      <input className="w-full bg-white/50 border-0 rounded-xl md:rounded-2xl px-4 md:px-5 py-2.5 md:py-3 text-[10px] md:text-sm font-bold shadow-sm" placeholder={texts.form_nip} value={nip} onChange={e => setNip(e.target.value)} />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 md:gap-3">
                    <input className="w-full bg-white/50 border-0 rounded-xl md:rounded-2xl px-4 md:px-5 py-2.5 md:py-3 text-[10px] md:text-sm font-bold shadow-sm" placeholder={texts.form_email} value={guestEmail} onChange={e => setEmail(e.target.value)} />
                    <input className="w-full bg-white/50 border-0 rounded-xl md:rounded-2xl px-4 md:px-5 py-2.5 md:py-3 text-[10px] md:text-sm font-bold shadow-sm" placeholder={texts.form_phone} value={guestPhone} onChange={e => setPhone(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(1)} className="flex-1 rounded-xl md:rounded-2xl font-bold h-10 md:h-12 text-xs md:text-sm">Back</Button>
                  <Button 
                    onClick={handleBooking} 
                    disabled={
                      (purpose === "leisure" ? !guestName : (!companyName || !nip)) || 
                      !guestEmail || 
                      !guestPhone || 
                      submitBooking.isPending
                    } 
                    className={`flex-[2] rounded-xl md:rounded-2xl ${primaryColor} font-black text-white text-sm md:text-base shadow-lg hover:opacity-90 h-10 md:h-12`}
                  >
                    {submitBooking.isPending ? "Sending..." : texts.submit}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="w-full max-w-sm md:max-w-xs space-y-3 md:space-y-4">
          <div className="bg-white/40 backdrop-blur-md rounded-[2rem] p-6 md:p-8 border border-white/40 shadow-xl">
             <h3 className="text-lg md:text-xl font-black mb-6 flex items-center gap-2">
               <Info className={textColor} />
               {texts.reviews_title}
             </h3>

             <div className="space-y-6">
               {["booking", "airbnb", "slowhop", "alohacamp", "google"].map((portal) => {
                 const ratingData = ratings.find(r => r.portal === portal);
                 if (!ratingData || ratingData.count === 0) return null;

                 const portalLabel = portal === "alohacamp" ? "AlohaCamp" : (portal.charAt(0).toUpperCase() + portal.slice(1));

                 return (
                   <div key={portal} className="flex items-center justify-between group">
                     <div className="flex items-center gap-3">
                       <div className="h-10 w-10 rounded-xl bg-white/60 flex items-center justify-center shadow-sm border border-white/60">
                         {portal === "booking" && <div className="text-blue-600 font-black text-sm">B.</div>}
                         {portal === "airbnb" && <div className="text-rose-500 font-black text-sm">A.</div>}
                         {portal === "slowhop" && <div className="text-emerald-700 font-black text-sm">S.</div>}
                         {portal === "alohacamp" && <div className="text-orange-500 font-black text-sm">Al.</div>}
                         {portal === "google" && <div className="text-blue-500 font-black text-sm">G.</div>}
                       </div>
                       <div>
                         <div className="text-[10px] font-black uppercase tracking-wider text-zinc-600">{texts.rating_from} {portalLabel}</div>
                         <div className="text-sm font-black text-zinc-900">{ratingData?.count || 0} {texts.ratings_count}</div>
                       </div>
                     </div>
                     <div className="text-right">
                       <div className="text-xl font-black text-zinc-900">{ratingData?.rating || "—"}</div>
                       <div className="flex gap-0.5 justify-end">
                         {[1, 2, 3, 4, 5].map(s => (
                           <div key={s} className={`h-1 w-1 rounded-full ${Number(ratingData?.rating || 0) / (portal === "booking" ? 2 : 1) >= s ? (portal === "booking" ? "bg-blue-600" : portal === "airbnb" ? "bg-rose-500" : portal === "slowhop" ? "bg-emerald-700" : portal === "alohacamp" ? "bg-orange-500" : "bg-blue-500") : "bg-zinc-200"}`} />
                         ))}
                       </div>
                     </div>
                   </div>
                 );
               })}
             </div>          </div>

          <div className="bg-white/20 backdrop-blur-sm rounded-2xl p-4 border border-white/20 flex items-center justify-center gap-4">
             <div className="text-center">
               <div className="text-[10px] font-black uppercase text-white/60 tracking-widest mb-1">{texts.total_score}</div>
               <div className="text-2xl font-black text-white">
                 {(() => {
                   const totalReviews = ratings.reduce((sum, r) => sum + r.count, 0);
                   if (totalReviews === 0) return "—";
                   const weightedSum = ratings.reduce((sum, r) => {
                     const normalizedRating = parseFloat(String(r.rating)) / (r.portal === "booking" ? 2 : 1);
                     return sum + (normalizedRating * r.count);
                   }, 0);
                   return (weightedSum / totalReviews).toFixed(1);
                 })()} / 5.0
               </div>
               <div className="text-[10px] text-white/70 mt-1">
                 {texts.based_on.replace("{count}", String(ratings.reduce((sum, r) => sum + r.count, 0)))}
               </div>
             </div>
          </div>        </div>
      </div>

      <div className="shrink-0 pb-1 md:pb-2">
        <div className="flex gap-3 md:gap-4 overflow-x-auto pb-1 md:pb-2 no-scrollbar px-1 md:px-2">
          {allThumbnails.map((item: any) => (
            <div 
              key={item.id} 
              className="shrink-0 w-32 md:w-64 group bg-white/40 backdrop-blur-md border border-white/40 rounded-xl md:rounded-2xl overflow-hidden cursor-pointer hover:bg-white/60 transition-all hover:-translate-y-1 shadow-sm"
              onClick={() => { setInitialFilter(item.folder); setGallery(true); }}
            >
              <div className="h-20 md:h-32 relative overflow-hidden">
                <img src={getThumbnailUrl(item.img, 400)} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center transition-colors">
                  <Maximize2 className="text-white opacity-0 group-hover:opacity-100 h-4 w-4 md:h-5 md:w-5" />
                </div>
              </div>
              <div className="p-2 md:p-3">
                <div className="font-black text-[10px] md:text-xs text-zinc-900 truncate">{item.name[lang]}</div>
                {item.beds && <div className="text-[8px] md:text-[10px] text-zinc-600 truncate mt-0.5">{item.beds[lang]}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SuccessPage({ lang }: { lang: Lang }) {
  const texts = T[lang];
  const [, setLocation] = useLocation();

  return (
    <div className="bg-white/70 backdrop-blur-md rounded-3xl shadow-2xl p-6 md:p-10 min-h-full flex items-center justify-center">
      <div className="max-w-xl text-center">
        <div className="h-20 w-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-8">
          <CheckCircle2 className="h-10 w-10" />
        </div>
        <h1 className="text-3xl font-black mb-4">{texts.success_title}</h1>
        <p className="text-zinc-600 mb-12 leading-relaxed">{texts.success_msg}</p>
        <Button onClick={() => setLocation("/")} className="bg-zinc-900 text-white px-8 py-6 rounded-2xl font-bold shadow-xl hover:scale-105 transition-all">
          Back to Home
        </Button>
      </div>
    </div>
  );
}
